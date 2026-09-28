# Hoop Stats backup server

A tiny HTTP service that keeps encrypted backups of the Hoop Stats app's data, so that a lost
phone or a deleted app doesn't mean lost stats. All real data lives on the phone (IndexedDB).
Whenever the phone has signal, the app uploads an encrypted snapshot here; on a new phone, the
backup code brings it back.

Stack: Node 22, TypeScript, [Hono](https://hono.dev), plain files on disk. Hosted on
[Fly.io](https://fly.io) with one small volume.

## Privacy model

- **Encrypted on the phone.** The app generates a random backup code and derives three things
  from it: an `accountId`, an `authToken`, and an AES-GCM key. Only the first two ever reach the
  server; the key never leaves the phone. Uploads are opaque ciphertext and the server never
  parses them.
- **What the server stores:** per account, `sha256(authToken)` and the encrypted snapshots, plus
  their sizes and upload times. Not the token itself, and nothing readable about players, games
  or stats.
- **What the server logs:** one line per request with method, path (account id cut to 8
  characters), status and duration. Never tokens, bodies or IP addresses.
- **No recovery.** Without the backup code nobody, including the server operator, can read or
  restore a backup.

## API

Base URL once deployed: `https://richshaw-hoop-stats.fly.dev`

| Method   | Path                              | Success                                                           |
| -------- | --------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/health`                         | `200 {"ok":true}` (no auth)                                       |
| `PUT`    | `/v1/backups/:accountId`          | `201 {"version","createdAt","size"}`                              |
| `GET`    | `/v1/backups/:accountId`          | `200 {"versions":[{"version","createdAt","size"}]}`, newest first |
| `GET`    | `/v1/backups/:accountId/latest`   | `200` newest snapshot bytes                                       |
| `GET`    | `/v1/backups/:accountId/:version` | `200` that snapshot's bytes                                       |
| `DELETE` | `/v1/backups/:accountId`          | `204`, account and all versions deleted                           |

- Every `/v1` request needs `Authorization: Bearer <authToken>`.
- `accountId` and `authToken` must be exactly 64 **lowercase** hex characters (otherwise `400`).
- Uploads are the raw encrypted bytes with `Content-Type: application/octet-stream`, 1 byte to
  5 MiB (5,242,880 bytes). The server stores them untouched.
- Snapshot downloads are streamed as `application/octet-stream` with `Content-Length`,
  `X-Backup-Version` and `X-Backup-Created-At` headers (all readable cross-origin). `HEAD` works
  too.
- Version ids look like `0000000042-20260928T041523123Z`: a per-account upload counter, then the
  UTC time the server received the upload. They sort in upload order as plain strings, whatever
  the server clock did. `createdAt` is that receive time (ISO 8601, UTC). Treat ids as opaque.

Example:

```sh
curl -X PUT "$BASE/v1/backups/$ACCOUNT_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @snapshot.bin
# {"version":"0000000042-20260928T041523123Z","createdAt":"2026-09-28T04:15:23.123Z","size":48213}

curl -D - -o restored.bin "$BASE/v1/backups/$ACCOUNT_ID/latest" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

### Accounts and authentication

- **Trust on first use.** The first successful upload to an unused `accountId` creates the
  account and records `sha256(authToken)`. From then on, every request for that account must
  present the same token (checked in constant time).
- **No account enumeration.** A wrong token and an account that doesn't exist get the same
  `401 {"error":"unauthorized"}` on every read and on `DELETE`, so the API never confirms that an
  account exists. (An upload can't hide it: by design it claims an unused id.) The ids are
  256-bit values derived from a 128-bit random code, so guessing them isn't feasible anyway.
- **Deleting** removes the account and every version. The id is free again afterwards: a later
  upload starts a brand-new account. An upload still arriving when its account is deleted is
  dropped (`401`); it never brings the account back.
- **One family, few accounts.** The server holds at most `MAX_ACCOUNTS` accounts (default 5) and
  creates at most `MAX_NEW_ACCOUNTS_PER_DAY` (default 3) per rolling 24 hours, across all
  clients. Anyone who finds the URL could claim the free slots, so if a stranger's account ever
  blocks yours, delete it on the server (see [Operating it](#operating-it)).

### Errors

Errors are JSON: `{"error": "<code>"}`.

| Status | `error`                 | Meaning                                                              |
| ------ | ----------------------- | -------------------------------------------------------------------- |
| 400    | `invalid_account_id`    | `accountId` isn't 64 lowercase hex chars                             |
| 400    | `invalid_version`       | Malformed version id                                                 |
| 400    | `invalid_token`         | `Authorization` isn't `Bearer <64 lowercase hex chars>`              |
| 400    | `empty_body`            | Upload had no bytes                                                  |
| 400    | `body_read_failed`      | The upload stream broke off (client disconnected)                    |
| 401    | `missing_token`         | No `Authorization` header                                            |
| 401    | `unauthorized`          | Wrong token, or no such account                                      |
| 403    | `origin_not_allowed`    | CORS preflight from an origin that isn't allowed                     |
| 404    | `not_found`             | No such version (or no versions yet), or unknown route               |
| 408    | (no body)               | The request took longer than `REQUEST_TIMEOUT_MS` to arrive          |
| 413    | `payload_too_large`     | Upload over 5 MiB                                                    |
| 429    | `rate_limited`          | Too many requests, or too many new accounts today; see `Retry-After` |
| 500    | `internal_error`        | Server bug; details are in the server log                            |
| 503    | `server_busy`           | Too many uploads arriving at once; see `Retry-After`                 |
| 507    | `account_limit_reached` | The server already holds `MAX_ACCOUNTS` accounts                     |
| 507    | `insufficient_storage`  | Disk space is below the reserve (or full); restores still work       |

### Retention

The app may upload every minute or so during a game, so keeping only the last N uploads would
push out all older history. After each upload the server keeps:

- the **20 most recent** versions, plus
- the **newest version of each UTC day for the last 180 days** (today counts as day 1).

Everything else is deleted. "Most recent" means most recently uploaded. The newest version is
never deleted, even if the app hasn't been used for a year. In steady use that's at most about
200 versions per account.

Two safety rules on top:

- **Storage budget.** An account's versions may take at most `MAX_ACCOUNT_BYTES` (default
  50 MiB) in total; beyond that the oldest are dropped first. Real snapshots are around 100 KB, so
  this only matters if something goes wrong.
- **Clock jumps.** If the previous upload looks more than a day old, the server keeps every
  day's snapshot for that one upload instead of pruning by age (and logs it). A clock that
  briefly jumps ahead therefore can't wipe months of history. The next upload, normally minutes
  later during a game, prunes as usual.

### Limits

| Limit                                         | Default | Env var                                       |
| --------------------------------------------- | ------- | --------------------------------------------- |
| Upload size (bytes)                           | 5 MiB   | `MAX_BODY_BYTES`                              |
| Storage per account (bytes)                   | 50 MiB  | `MAX_ACCOUNT_BYTES`                           |
| Accounts in total                             | 5       | `MAX_ACCOUNTS`                                |
| New accounts per 24 hours (all clients)       | 3       | `MAX_NEW_ACCOUNTS_PER_DAY`                    |
| Free disk to keep in reserve (%; 0 = off)     | 20      | `MIN_FREE_DISK_PERCENT`                       |
| Uploads arriving at once (all clients)        | 4       | `MAX_CONCURRENT_UPLOADS`                      |
| Requests per client IP per minute             | 120     | `RATE_LIMIT_PER_IP_PER_MINUTE`                |
| Uploads per account per minute                | 20      | `RATE_LIMIT_WRITES_PER_ACCOUNT_PER_MINUTE`    |
| Downloads per account per minute              | 30      | `RATE_LIMIT_DOWNLOADS_PER_ACCOUNT_PER_MINUTE` |
| Time to send a whole request (ms), then `408` | 60000   | `REQUEST_TIMEOUT_MS`                          |

How they fit together:

- **Uploads can't fill the disk.** Data is bounded to about 5 accounts × 50 MiB, uploads arrive
  into `incoming/` at most 4 at a time, and every upload is refused (`507`) while free space is
  below 20%. If the disk fills anyway, existing backups stay intact, the server still starts,
  and restores keep working; only uploads fail.
- **Uploads never hold up an account.** The body is received before the account is locked, so a
  phone that loses signal mid-upload doesn't block its next upload or a delete; its half-sent
  request is dropped after `REQUEST_TIMEOUT_MS` (Node answers `408`).
- **Bad signal isn't penalized.** An upload that breaks off doesn't count against the per-account
  upload limit, and only accounts that were actually created count toward the account caps. The
  daily account cap is kept on disk, so it survives restarts.
- Oversized uploads are refused from `Content-Length` when present, and otherwise cut off while
  streaming, so the server never buffers more than the limit. Downloads are streamed from disk.

The client IP is taken from Fly's `Fly-Client-IP` header, or the socket address when running
elsewhere. That header is trusted, so in production the server must sit behind Fly's proxy
(which sets it). IPv6 clients are grouped by /64. `/health` and CORS preflights aren't rate limited.

### CORS

Only origins listed in `ALLOWED_ORIGINS` get CORS headers (in production:
`https://richshaw.github.io`). They may use `GET`, `PUT`, `DELETE` and `OPTIONS` with the
`Authorization` and `Content-Type` headers. Preflights are cached for 24 hours. CORS headers are
added to error responses too, so the app can read a `401`, `413` or `429`, and `Retry-After` is
exposed along with the version headers. Any other origin gets no CORS headers, and its preflights
are answered with `403`.

### Notes for the app

- Lowercase all hex. Treat `401` on restore as "no backup for this code": a typo, or a backup
  that was deleted. After a successful `DELETE`, a retried `DELETE` also gets `401`.
- The machine sleeps when idle, so the first request after a quiet spell can take a couple of
  seconds while it starts. Use a generous timeout (about 30 s) and simply retry on the next
  upload.
- On `429` or `503`, wait for `Retry-After`. On network errors or `507`, keep the data locally
  and try again later. Uploading the same data twice is harmless.
- `507 account_limit_reached` on a first upload means the server is full of accounts; retrying
  won't help until the owner frees a slot.
- The server doesn't deduplicate uploads, so the app can skip uploading when nothing changed.

## Configuration

| Env var                     | Default               | Notes                                              |
| --------------------------- | --------------------- | -------------------------------------------------- |
| `PORT`                      | `8080`                |                                                    |
| `DATA_DIR`                  | `./data`              | `/data` on Fly (the mounted volume)                |
| `ALLOWED_ORIGINS`           | (none)                | Comma-separated, e.g. `https://richshaw.github.io` |
| `RETENTION_KEEP_RECENT`     | `20`                  |                                                    |
| `RETENTION_KEEP_DAILY_DAYS` | `180`                 |                                                    |
| Limits and timeouts         | see [Limits](#limits) |                                                    |

Invalid values stop the server at startup with a clear message (`MAX_ACCOUNT_BYTES` must be at
least `MAX_BODY_BYTES`), and so does a data directory it isn't allowed to write to. A full disk
doesn't: startup writes nothing.

## Local development

```sh
cd server
npm ci
npm run dev                  # http://localhost:8080, data in ./data, restarts on changes
npm test                     # vitest: temp dirs, real-server tests on 127.0.0.1 only
npm run lint && npm run format:check && npm run typecheck
npm run build && npm start   # compiled server from dist/
```

To let a local copy of the web app call it, allow its origin, e.g.
`ALLOWED_ORIGINS=http://localhost:5173 npm run dev`. If your laptop's disk is more than 80% full,
uploads get `507` locally; add `MIN_FREE_DISK_PERCENT=0`.

One test starts the server on a genuinely full 2 MB tmpfs. Mounting needs root, so it only runs
where that's allowed (e.g. a privileged dev container) and is skipped elsewhere, including CI.

Quick check with curl (any 64-hex strings work as a test account):

```sh
ACCOUNT_ID=$(openssl rand -hex 32); AUTH_TOKEN=$(openssl rand -hex 32)
head -c 1000 /dev/urandom > snapshot.bin
curl -X PUT "http://localhost:8080/v1/backups/$ACCOUNT_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN" --data-binary @snapshot.bin
curl "http://localhost:8080/v1/backups/$ACCOUNT_ID" -H "Authorization: Bearer $AUTH_TOKEN"
```

### How data is stored

```
$DATA_DIR/accounts/<accountId>/auth.json               {"tokenSha256": "...", "createdAt": "..."}
$DATA_DIR/accounts/<accountId>/versions/<version>.bin  encrypted bytes, as uploaded
$DATA_DIR/incoming/                                    uploads still arriving
$DATA_DIR/trash/                                       deleted accounts on their way out
$DATA_DIR/new-accounts/                                one empty file per recent account creation
```

An upload is received into `incoming/` and fsynced, then renamed into its account's `versions/`
(same filesystem, so the move is atomic); `auth.json` is written the same way via a temp file.
A crash therefore never leaves a half-written file visible. Deleting an account first renames
its directory into `trash/` (one atomic step). On startup, `trash/` and `incoming/` are emptied.
Commits and deletes for an account are serialized in memory, which assumes a single server
process; that's how it runs on Fly (one machine, one volume).

## Deploying to Fly.io

When a push to `main` touches `server/`, [`server-ci.yml`](../.github/workflows/server-ci.yml)
runs the checks, and only once they pass does
[`deploy-server.yml`](../.github/workflows/deploy-server.yml) deploy that exact commit with
`flyctl deploy --remote-only --ha=false` (the image is built on Fly's builders). A failing build
is never deployed. Until the one-time setup below is done, the deploy is skipped with a notice
instead of failing.

### One-time setup (owner)

1. Install flyctl (<https://fly.io/docs/flyctl/install/>) and sign in with `fly auth login`.
2. Create the app and its volume:

   ```sh
   fly apps create richshaw-hoop-stats
   fly volumes create hoop_data --app richshaw-hoop-stats --region ord --size 1
   ```

   flyctl warns that a single volume has no redundancy; answer yes. This app intentionally runs
   one machine, and Fly snapshots the volume daily (see below). If you'd rather use another
   region than `ord` (Chicago), create the volume there and change `primary_region` in
   [`fly.toml`](fly.toml) to match.

3. Create a deploy token and store it in GitHub:

   ```sh
   fly tokens create deploy --app richshaw-hoop-stats
   ```

   Copy the whole output (it starts with `FlyV1 `). In the GitHub repo, go to Settings →
   Secrets and variables → Actions → New repository secret, name it `FLY_API_TOKEN` and paste
   the token.

4. Deploy: Actions → **Deploy backup server** → Run workflow on `main` (or push a change under
   `server/` to `main`). Then check `curl https://richshaw-hoop-stats.fly.dev/health` returns
   `{"ok":true}`.

### Operating it

- **Logs:** `fly logs --app richshaw-hoop-stats`
- **Snapshots:** Fly takes a daily snapshot of the `hoop_data` volume and keeps it for 5 days by
  default (see `fly volumes update --help` to change that). Find them with:

  ```sh
  fly volumes list --app richshaw-hoop-stats
  fly volumes snapshots list <volume-id>
  ```

  A snapshot can be turned into a new volume with `fly volumes create --snapshot-id <id>`; see
  Fly's volume docs for attaching it in place of the current one.

- **Space:** the caps above bound the data to about 250 MB (5 accounts × 50 MiB) on the 1 GB
  volume. Uploads stop with `507` while less than 20% is free; existing backups and restores
  are unaffected. To grow the volume: `fly volumes extend <volume-id> --size 2`.
- **Freeing an account slot:** list accounts and delete a stranger's (the id is the directory
  name; `auth.json` shows when it was created):

  ```sh
  fly ssh console --app richshaw-hoop-stats -C "ls -l /data/accounts"
  fly ssh console --app richshaw-hoop-stats -C "rm -rf /data/accounts/<accountId>"
  ```

- **Cost:** the machine stops when idle and starts on the next request, so it mostly costs the
  volume.
