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
  UTC time the upload started. Both are fixed when the upload starts, so ids sort (as plain
  strings) in the order uploads began, whatever the server clock did: a slow upload of older data
  can't overtake newer data and become `latest`. `createdAt` is that start time (ISO 8601, UTC).
  Treat ids as opaque; numbers may skip.

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
  upload starts a brand-new account. Any upload that started before the `DELETE` (even the
  account's very first one, still arriving) is dropped with `409 account_deleted`: it never
  brings the account back or lands in a re-created one. A `DELETE` with a wrong token cancels
  nothing.
- **One family, few accounts.** The server holds at most `MAX_ACCOUNTS` accounts (default 5) and
  creates at most `MAX_NEW_ACCOUNTS_PER_DAY` (default 3) per rolling 24 hours, across all
  clients. Anyone who finds the URL could claim the free slots, so if a stranger's account ever
  blocks yours, delete it on the server (see [Operating it](#operating-it)).

### Errors

Errors are JSON: `{"error": "<code>"}`.

| Status | `error`                 | Meaning                                                           |
| ------ | ----------------------- | ----------------------------------------------------------------- |
| 400    | `invalid_account_id`    | `accountId` isn't 64 lowercase hex chars                          |
| 400    | `invalid_version`       | Malformed version id                                              |
| 400    | `invalid_token`         | `Authorization` isn't `Bearer <64 lowercase hex chars>`           |
| 400    | `empty_body`            | Upload had no bytes                                               |
| 400    | `body_read_failed`      | The upload stream broke off (client disconnected)                 |
| 401    | `missing_token`         | No `Authorization` header                                         |
| 401    | `unauthorized`          | Wrong token, or no such account                                   |
| 403    | `origin_not_allowed`    | CORS preflight from an origin that isn't allowed                  |
| 404    | `not_found`             | No such version (or no versions yet), or unknown route            |
| 408    | `upload_stalled`        | No upload bytes arrived for `UPLOAD_STALL_TIMEOUT_MS`             |
| 408    | (no body)               | The request took longer than `REQUEST_TIMEOUT_MS` to arrive       |
| 409    | `account_deleted`       | The account was deleted after this upload started; nothing stored |
| 413    | `payload_too_large`     | Upload over 5 MiB                                                 |
| 429    | `rate_limited`          | Too many requests, uploads from this IP at once, or new accounts  |
| 500    | `internal_error`        | Server bug; details are in the server log                         |
| 503    | `server_busy`           | Too many uploads arriving at once; see `Retry-After`              |
| 507    | `account_limit_reached` | The server already holds `MAX_ACCOUNTS` accounts                  |
| 507    | `insufficient_storage`  | Disk space is below the reserve (or full); restores still work    |

### Retention

The app may upload every minute or so during a game, so keeping only the last N uploads would
push out all older history. After each upload the server keeps:

- the **20 most recent** versions, plus
- the **newest version of each of the last 180 UTC days that have uploads**.

Everything else is deleted. "Most recent" means most recently started, and days are ranked by
their newest upload; days without uploads don't count. So:

- An account never holds more than 20 + 180 versions, however it is used.
- Nothing is deleted for being old: a family that uploads only on game days keeps a snapshot of
  each of its last 180 game days, even if they span years. The newest version is never deleted.
- The server's clock plays no part. A clock that jumps ahead can push out at most one old day
  for each day it invents, no matter how many uploads happen meanwhile.

On top of that, an account's versions may take at most `MAX_ACCOUNT_BYTES` (default 50 MiB) in
total; beyond that the oldest are dropped first. Real snapshots are around 100 KB, so this only
matters if something goes wrong.

### Limits

| Limit                                         | Default | Env var                                       |
| --------------------------------------------- | ------- | --------------------------------------------- |
| Upload size (bytes)                           | 5 MiB   | `MAX_BODY_BYTES`                              |
| Storage per account (bytes)                   | 50 MiB  | `MAX_ACCOUNT_BYTES`                           |
| Accounts in total                             | 5       | `MAX_ACCOUNTS`                                |
| New accounts per 24 hours (all clients)       | 3       | `MAX_NEW_ACCOUNTS_PER_DAY`                    |
| Free disk to keep in reserve (%; 0 = off)     | 20      | `MIN_FREE_DISK_PERCENT`                       |
| Uploads arriving at once (all clients)        | 4       | `MAX_CONCURRENT_UPLOADS`                      |
| … of which first uploads to unknown ids       | 1       | `MAX_CONCURRENT_NEW_ACCOUNT_UPLOADS`          |
| Uploads arriving at once from one client IP   | 2       | `MAX_CONCURRENT_UPLOADS_PER_IP`               |
| Upload with no progress for (ms), then `408`  | 10000   | `UPLOAD_STALL_TIMEOUT_MS`                     |
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
  upload is dropped once no bytes have arrived for `UPLOAD_STALL_TIMEOUT_MS` (`408`).
- **Strangers can't take the family's upload slots.** Anyone can start a first upload to an
  unused id, so those may hold only 1 of the 4 slots at a time (the rest are for existing
  accounts, which need their token), and one client IP may hold at most 2.
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
- `409 account_deleted` answers an upload that was still arriving when its account was deleted
  (normally by this same phone turning backup off). Nothing was stored; don't retry it.
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
least `MAX_BODY_BYTES`, and `MAX_CONCURRENT_NEW_ACCOUNT_UPLOADS` below `MAX_CONCURRENT_UPLOADS`),
and so does a data directory it isn't allowed to write to. A full disk doesn't: startup needs no
free space.

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
its directory into `trash/` (one atomic step); `trash/` is created with the first account (and
at startup if there's room), so deleting works even on a full disk. On startup, `trash/` and
`incoming/` are emptied. Sequence numbers are handed out, and commits and deletes serialized, in
memory, which assumes a single server process; that's how it runs on Fly (one machine, one
volume).

## Deploying to Fly.io

When a push to `main` touches `server/`, [`server-ci.yml`](../.github/workflows/server-ci.yml)
runs the checks, and only once they pass does
[`deploy-server.yml`](../.github/workflows/deploy-server.yml) deploy that exact commit with
`flyctl deploy --remote-only --ha=false` (the image is built on Fly's builders). A failing build
is never deployed, and neither is a commit that is no longer the tip of `main` (e.g. when an old
CI run is re-run). Until the one-time setup below is done, the deploy is skipped with a notice
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
