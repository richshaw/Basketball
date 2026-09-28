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
  10 MiB (10,485,760 bytes). The server stores them untouched.
- Snapshot downloads come back as `application/octet-stream` with `X-Backup-Version` and
  `X-Backup-Created-At` headers (both readable cross-origin).
- Version ids look like `20260928T041523123Z-9f86d081` (UTC timestamp to the millisecond plus a
  random suffix). They sort chronologically as plain strings and always increase within an
  account. `createdAt` is the server's receive time (ISO 8601, UTC).

Example:

```sh
curl -X PUT "$BASE/v1/backups/$ACCOUNT_ID" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @snapshot.bin
# {"version":"20260928T041523123Z-9f86d081","createdAt":"2026-09-28T04:15:23.123Z","size":48213}

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
  upload starts a brand-new account.

### Errors

Errors are JSON: `{"error": "<code>"}`.

| Status | `error`                | Meaning                                                 |
| ------ | ---------------------- | ------------------------------------------------------- |
| 400    | `invalid_account_id`   | `accountId` isn't 64 lowercase hex chars                |
| 400    | `invalid_version`      | Malformed version id                                    |
| 400    | `invalid_token`        | `Authorization` isn't `Bearer <64 lowercase hex chars>` |
| 400    | `empty_body`           | Upload had no bytes                                     |
| 400    | `body_read_failed`     | The upload stream broke off (client disconnected)       |
| 401    | `missing_token`        | No `Authorization` header                               |
| 401    | `unauthorized`         | Wrong token, or no such account                         |
| 403    | `origin_not_allowed`   | CORS preflight from an origin that isn't allowed        |
| 404    | `not_found`            | No such version (or no versions yet), or unknown route  |
| 413    | `payload_too_large`    | Upload over 10 MiB                                      |
| 429    | `rate_limited`         | Too many requests; wait `Retry-After` seconds           |
| 500    | `internal_error`       | Server bug; details are in the server log               |
| 507    | `insufficient_storage` | The volume is full                                      |

### Retention

The app may upload every minute or so during a game, so keeping only the last N uploads would
push out all older history. After each upload the server keeps:

- the **20 most recent** versions, plus
- the **newest version of each UTC day for the last 180 days** (today counts as day 1).

Everything else is deleted. The newest version is never deleted, even if the app hasn't been used
for a year. In steady use that's at most about 200 versions per account.

### Limits

| Limit                               | Default | Env var                                    |
| ----------------------------------- | ------- | ------------------------------------------ |
| Upload size (bytes)                 | 10 MiB  | `MAX_BODY_BYTES`                           |
| Requests per client IP per minute   | 120     | `RATE_LIMIT_PER_IP_PER_MINUTE`             |
| Uploads per account per minute      | 20      | `RATE_LIMIT_WRITES_PER_ACCOUNT_PER_MINUTE` |
| New accounts per client IP per hour | 10      | `RATE_LIMIT_NEW_ACCOUNTS_PER_IP_PER_HOUR`  |

The client IP is taken from Fly's `Fly-Client-IP` header, or the socket address when running
elsewhere. That header is trusted, so in production the server must sit behind Fly's proxy
(which sets it). IPv6 clients are grouped by /64. `/health` and CORS preflights aren't rate limited.
Oversized uploads are refused from `Content-Length` when present, and otherwise cut off while
streaming, so the server never buffers more than the limit.

### CORS

Only origins listed in `ALLOWED_ORIGINS` get CORS headers (in production:
`https://richshaw.github.io`). They may use `GET`, `PUT`, `DELETE` and `OPTIONS` with the
`Authorization` and `Content-Type` headers. Preflights are cached for 24 hours. CORS headers are
added to error responses too, so the app can read a `401`, `413` or `429`. Any other origin gets
no CORS headers, and its preflights are answered with `403`.

### Notes for the app

- Lowercase all hex. Treat `401` on restore as "no backup for this code": a typo, or a backup
  that was deleted. After a successful `DELETE`, a retried `DELETE` also gets `401`.
- The machine sleeps when idle, so the first request after a quiet spell can take a couple of
  seconds while it starts. Use a generous timeout (about 30 s) and simply retry on the next
  upload.
- On `429`, wait for `Retry-After`. On network errors, keep the data locally and try again
  later. Uploading the same data twice is harmless.
- The server doesn't deduplicate uploads, so the app can skip uploading when nothing changed.

## Configuration

| Env var                     | Default               | Notes                                              |
| --------------------------- | --------------------- | -------------------------------------------------- |
| `PORT`                      | `8080`                |                                                    |
| `DATA_DIR`                  | `./data`              | `/data` on Fly (the mounted volume)                |
| `ALLOWED_ORIGINS`           | (none)                | Comma-separated, e.g. `https://richshaw.github.io` |
| `RETENTION_KEEP_RECENT`     | `20`                  |                                                    |
| `RETENTION_KEEP_DAILY_DAYS` | `180`                 |                                                    |
| Rate/size limits            | see [Limits](#limits) |                                                    |

Invalid values stop the server at startup with a clear message, and so does a data directory
it can't write to.

## Local development

```sh
cd server
npm ci
npm run dev                  # http://localhost:8080, data in ./data, restarts on changes
npm test                     # vitest (temp dirs only, no network)
npm run lint && npm run format:check && npm run typecheck
npm run build && npm start   # compiled server from dist/
```

To let a local copy of the web app call it, allow its origin, e.g.
`ALLOWED_ORIGINS=http://localhost:5173 npm run dev`.

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
$DATA_DIR/trash/                                       deleted accounts on their way out
```

Every write goes to a temp file in the same directory, is fsynced, then renamed into place, so a
crash never leaves a half-written file visible. Deleting an account first renames its directory
into `trash/` (one atomic step), and leftovers there are cleared on startup. Writes to an account
are serialized in memory, which assumes a single server process; that's how it runs on Fly (one
machine, one volume).

## Deploying to Fly.io

Pushes to `main` that touch `server/` run
[`deploy-server.yml`](../.github/workflows/deploy-server.yml), which runs
`flyctl deploy --remote-only --ha=false` (the image is built on Fly's builders). Until the
one-time setup below is done, that workflow skips the deploy with a notice instead of failing.

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

4. Deploy: Actions → **Deploy backup server** → Run workflow (or push a change under `server/`
   to `main`). Then check `curl https://richshaw-hoop-stats.fly.dev/health` returns
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

- **Space:** at 500 KB per snapshot, one busy account tops out around 100 MB (about 200
  versions), so 1 GB goes a long way. If the volume ever fills up, uploads fail with `507` and
  existing backups stay intact; grow it with `fly volumes extend <volume-id> --size 2`.
- **Cost:** the machine stops when idle and starts on the next request, so it mostly costs the
  volume.
