import type { Context } from 'hono';
import { Hono } from 'hono';
import { hashToken, isHex64, parseBearer, tokenMatches } from './auth.js';
import type { AppConfig, Limits } from './config.js';
import { DEFAULT_LIMITS, DEFAULT_RETENTION } from './config.js';
import {
  cors,
  describeError,
  ipRateLimit,
  redactIds,
  requestLogger,
  securityHeaders,
  tooManyRequests,
} from './middleware.js';
import { FixedWindowRateLimiter } from './rateLimit.js';
import type { RetentionPolicy, SizedVersionStamp } from './retention.js';
import { DAY_MS, capTotalSize, planRetention } from './retention.js';
import type { DiskSpace, StoredVersion, UploadResult, VersionRef } from './store.js';
import { BackupStore, BodyReadError, isErrno, readDiskSpace } from './store.js';
import { nextVersionId, parseVersionId } from './versionId.js';

/** Options for {@link createApp}. Only `dataDir` is required; the rest have production defaults. */
export interface AppOptions {
  dataDir: string;
  allowedOrigins?: readonly string[];
  limits?: Partial<Limits>;
  retention?: Partial<RetentionPolicy>;
  now?: () => number;
  log?: (line: string) => void;
  diskSpace?: (dir: string) => Promise<DiskSpace>;
}

type ErrorCode =
  | 'invalid_account_id'
  | 'invalid_version'
  | 'invalid_token'
  | 'missing_token'
  | 'unauthorized'
  | 'empty_body'
  | 'body_read_failed'
  | 'payload_too_large'
  | 'not_found'
  | 'server_busy'
  | 'account_limit_reached'
  | 'insufficient_storage'
  | 'internal_error';

type ErrorStatus = 400 | 401 | 404 | 413 | 500 | 503 | 507;

const MINUTE_MS = 60_000;
const BUSY_RETRY_AFTER_SECONDS = 5;

function fail(c: Context, status: ErrorStatus, error: ErrorCode): Response {
  const headers: Record<string, string> = {};
  // 401s advertise the scheme (RFC 6750); a bare "Bearer" never triggers a browser prompt.
  if (status === 401) headers['WWW-Authenticate'] = 'Bearer';
  if (status === 503) headers['Retry-After'] = String(BUSY_RETRY_AFTER_SECONDS);
  return c.json({ error }, status, headers);
}

const toIso = (ms: number): string => new Date(ms).toISOString();
const shortId = (accountId: string): string => `${accountId.slice(0, 8)}...`;

type Credentials =
  { ok: true; accountId: string; token: string } | { ok: false; response: Response };

/** Validates the account id and bearer token formats (400/401) before anything touches disk. */
function readCredentials(c: Context, accountId: string): Credentials {
  if (!isHex64(accountId)) return { ok: false, response: fail(c, 400, 'invalid_account_id') };
  const bearer = parseBearer(c.req.header('Authorization'));
  if (bearer.kind === 'missing') return { ok: false, response: fail(c, 401, 'missing_token') };
  if (bearer.kind === 'malformed') return { ok: false, response: fail(c, 400, 'invalid_token') };
  return { ok: true, accountId, token: bearer.token };
}

export function createApp(options: AppOptions): Hono {
  const config: AppConfig = {
    dataDir: options.dataDir,
    allowedOrigins: options.allowedOrigins ?? [],
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    retention: { ...DEFAULT_RETENTION, ...options.retention },
    now: options.now ?? Date.now,
    log: options.log ?? ((line: string) => console.log(line)),
    diskSpace: options.diskSpace ?? readDiskSpace,
  };
  const { limits } = config;
  const store = new BackupStore(config.dataDir);
  const ipLimiter = new FixedWindowRateLimiter(
    limits.requestsPerIpPerMinute,
    MINUTE_MS,
    config.now,
  );
  const writeLimiter = new FixedWindowRateLimiter(
    limits.writesPerAccountPerMinute,
    MINUTE_MS,
    config.now,
  );
  const downloadLimiter = new FixedWindowRateLimiter(
    limits.downloadsPerAccountPerMinute,
    MINUTE_MS,
    config.now,
  );
  let uploadsInFlight = 0;

  /**
   * Enumeration-safe check: an unknown account and a wrong token are indistinguishable (both
   * false, both answered with the same 401), so the API never confirms that an account exists.
   */
  async function isAuthorized(accountId: string, token: string): Promise<boolean> {
    const auth = await store.readAuth(accountId);
    return tokenMatches(token, auth?.tokenSha256 ?? null);
  }

  /** Why a new account can't be created right now, or null if it can. */
  async function newAccountRefusal(c: Context): Promise<Response | null> {
    if ((await store.countAccounts()) >= limits.maxAccounts) {
      return fail(c, 507, 'account_limit_reached');
    }
    const now = config.now();
    const recent = await store.recentAccountCreations(now, DAY_MS);
    if (recent.length >= limits.maxNewAccountsPerDay) {
      // A slot opens when enough of the recent creations have aged out of the 24h window.
      const freesSlot = recent[recent.length - limits.maxNewAccountsPerDay] ?? now;
      return tooManyRequests(c, Math.max(1, Math.ceil((freesSlot + DAY_MS - now) / 1000)));
    }
    return null;
  }

  /** True when free disk space is below the configured reserve. */
  async function lowOnDisk(): Promise<boolean> {
    if (limits.minFreeDiskPercent <= 0) return false;
    try {
      const { freeBytes, totalBytes } = await config.diskSpace(config.dataDir);
      return totalBytes > 0 && (freeBytes / totalBytes) * 100 < limits.minFreeDiskPercent;
    } catch (err) {
      // Can't tell; don't block backups over it (a truly full disk still fails with 507).
      config.log(`disk space check failed: ${describeError(err)}`);
      return false;
    }
  }

  /**
   * Retention after a successful upload. Pruning is housekeeping: failures are logged, never
   * reported to the client, whose upload is already safely stored.
   */
  async function prune(
    accountId: string,
    created: SizedVersionStamp,
    previous: StoredVersion[],
    now: number,
  ): Promise<void> {
    try {
      // If the previous upload looks more than a day old, the clock may have jumped ahead;
      // pruning by age now could wipe months of daily snapshots. Skip it this time: the next
      // upload (normally minutes later during a game) prunes as usual.
      const newestBefore = previous[0];
      const pruneByAge = newestBefore === undefined || now - newestBefore.createdAtMs <= DAY_MS;
      if (!pruneByAge && newestBefore !== undefined) {
        const days = ((now - newestBefore.createdAtMs) / DAY_MS).toFixed(1);
        config.log(
          `retention: previous upload for ${shortId(accountId)} is ${days} days old; ` +
            'skipping age-based pruning for this upload',
        );
      }
      const all = [created, ...previous];
      const plan = planRetention(all, now, config.retention, { pruneByAge });
      const capped = capTotalSize(plan.keep, limits.maxAccountBytes);
      const doomed = [...plan.remove, ...capped.remove].map((v) => v.version);
      await store.deleteVersions(accountId, doomed);
    } catch (err) {
      config.log(`retention pruning failed: ${describeError(err)}`);
    }
  }

  /**
   * Second half of an upload, run under the account lock once the body is safely in
   * incoming/: re-check the account, create it if needed, assign the version id, move the file
   * into place and prune. The temp file is discarded on every path that doesn't store it.
   */
  async function commit(
    c: Context,
    accountId: string,
    token: string,
    hadAccount: boolean,
    upload: { tempPath: string; size: number },
  ): Promise<Response> {
    let stored = false;
    try {
      const auth = await store.readAuth(accountId);
      if (auth === null) {
        // Deleted while the body was arriving ("turn off backup"): don't bring it back.
        if (hadAccount) return fail(c, 401, 'unauthorized');
        const refusal = await store.withCreationLock(async () => {
          const reason = await newAccountRefusal(c);
          if (reason === null) {
            const now = config.now();
            await store.createAccount(
              accountId,
              { tokenSha256: hashToken(token), createdAt: toIso(now) },
              now,
            );
          }
          return reason;
        });
        if (refusal !== null) return refusal;
      } else if (!tokenMatches(token, auth.tokenSha256)) {
        return fail(c, 401, 'unauthorized');
      }

      await store.removeStaleTempFiles(accountId);
      const previous = await store.listVersions(accountId);
      const now = config.now();
      const created = nextVersionId(now, previous[0]?.version);
      await store.commitUpload(accountId, upload.tempPath, created.version);
      stored = true;
      await prune(accountId, { ...created, size: upload.size }, previous, now);
      return c.json(
        { version: created.version, createdAt: toIso(created.createdAtMs), size: upload.size },
        201,
      );
    } finally {
      if (!stored) await store.discardUpload(upload.tempPath);
    }
  }

  /** Streams one version (or just its headers for HEAD). */
  async function sendVersion(c: Context, accountId: string, ref: VersionRef): Promise<Response> {
    const headers = {
      'Content-Type': 'application/octet-stream',
      'X-Backup-Version': ref.version,
      'X-Backup-Created-At': toIso(ref.createdAtMs),
    };
    if (c.req.method === 'HEAD') {
      const size = await store.versionSize(accountId, ref.version);
      if (size === null) return fail(c, 404, 'not_found');
      return c.body(null, 200, { ...headers, 'Content-Length': String(size) });
    }
    const opened = await store.openVersion(accountId, ref.version);
    if (opened === null) return fail(c, 404, 'not_found');
    return c.body(opened.stream, 200, { ...headers, 'Content-Length': String(opened.size) });
  }

  const app = new Hono();

  app.use(requestLogger(config.log));
  app.use(securityHeaders());
  app.use(cors(config.allowedOrigins));
  app.use(ipRateLimit(ipLimiter));

  app.get('/health', (c) => c.json({ ok: true }));

  // Upload a new version. The first upload for an account claims it (trust on first use).
  app.put('/v1/backups/:accountId', async (c) => {
    const creds = readCredentials(c, c.req.param('accountId'));
    if (!creds.ok) return creds.response;
    const { accountId, token } = creds;

    // Everything that can refuse the upload runs before a single body byte is read, and
    // without taking the account lock.
    if (Number(c.req.header('Content-Length')) > limits.maxBodyBytes) {
      return fail(c, 413, 'payload_too_large');
    }
    const auth = await store.readAuth(accountId);
    if (auth !== null && !tokenMatches(token, auth.tokenSha256)) {
      return fail(c, 401, 'unauthorized');
    }
    if (auth === null) {
      const refusal = await newAccountRefusal(c);
      if (refusal !== null) return refusal;
    }
    if (await lowOnDisk()) return fail(c, 507, 'insufficient_storage');
    if (uploadsInFlight >= limits.maxConcurrentUploads) return fail(c, 503, 'server_busy');
    const decision = writeLimiter.hit(accountId);
    if (!decision.allowed) return tooManyRequests(c, decision.retryAfterSeconds);

    // Receive the body into incoming/ with no lock held: a phone that loses signal mid-upload
    // must not block its own next upload (or a delete) until the request times out.
    uploadsInFlight += 1;
    let keepCharge = false; // refund the write allowance unless the attempt counts against it
    try {
      let upload: UploadResult;
      try {
        upload = await store.receiveUpload(c.req.raw.body, limits.maxBodyBytes);
      } catch (err) {
        if (err instanceof BodyReadError) return fail(c, 400, 'body_read_failed');
        throw err;
      }
      if (upload.kind !== 'received') {
        keepCharge = true; // the client sent a bad body; that attempt counts
        return upload.kind === 'too_large'
          ? fail(c, 413, 'payload_too_large')
          : fail(c, 400, 'empty_body');
      }
      const received = upload;
      const response = await store.withAccountLock(accountId, () =>
        commit(c, accountId, token, auth !== null, received),
      );
      keepCharge = response.status === 201;
      return response;
    } finally {
      uploadsInFlight -= 1;
      if (!keepCharge) writeLimiter.refund(accountId);
    }
  });

  // List versions, newest first.
  app.get('/v1/backups/:accountId', async (c) => {
    const creds = readCredentials(c, c.req.param('accountId'));
    if (!creds.ok) return creds.response;
    if (!(await isAuthorized(creds.accountId, creds.token))) return fail(c, 401, 'unauthorized');
    const versions = await store.listVersions(creds.accountId);
    return c.json({
      versions: versions.map((v) => ({
        version: v.version,
        createdAt: toIso(v.createdAtMs),
        size: v.size,
      })),
    });
  });

  // Newest blob. Registered before '/:version' so "latest" is never parsed as a version id.
  app.get('/v1/backups/:accountId/latest', async (c) => {
    const creds = readCredentials(c, c.req.param('accountId'));
    if (!creds.ok) return creds.response;
    if (!(await isAuthorized(creds.accountId, creds.token))) return fail(c, 401, 'unauthorized');
    const decision = downloadLimiter.hit(creds.accountId);
    if (!decision.allowed) return tooManyRequests(c, decision.retryAfterSeconds);
    const [newest] = await store.listVersionRefs(creds.accountId);
    if (newest === undefined) return fail(c, 404, 'not_found');
    return sendVersion(c, creds.accountId, newest);
  });

  // A specific blob.
  app.get('/v1/backups/:accountId/:version', async (c) => {
    const creds = readCredentials(c, c.req.param('accountId'));
    if (!creds.ok) return creds.response;
    const version = c.req.param('version');
    const parsed = parseVersionId(version);
    if (parsed === null) return fail(c, 400, 'invalid_version');
    if (!(await isAuthorized(creds.accountId, creds.token))) return fail(c, 401, 'unauthorized');
    const decision = downloadLimiter.hit(creds.accountId);
    if (!decision.allowed) return tooManyRequests(c, decision.retryAfterSeconds);
    return sendVersion(c, creds.accountId, { version, createdAtMs: parsed.createdAtMs });
  });

  // Delete the account and every version ("turn off backup and delete my cloud copy").
  app.delete('/v1/backups/:accountId', async (c) => {
    const creds = readCredentials(c, c.req.param('accountId'));
    if (!creds.ok) return creds.response;
    const { accountId, token } = creds;
    return store.withAccountLock(accountId, async () => {
      if (!(await isAuthorized(accountId, token))) return fail(c, 401, 'unauthorized');
      await store.deleteAccount(accountId);
      return c.body(null, 204);
    });
  });

  app.notFound((c) => fail(c, 404, 'not_found'));

  app.onError((err, c) => {
    const where = `${c.req.method} ${redactIds(new URL(c.req.url).pathname)}`;
    config.log(`error in ${where}: ${describeError(err)}`);
    if (isErrno(err, 'ENOSPC') || isErrno(err, 'EDQUOT')) {
      return fail(c, 507, 'insufficient_storage');
    }
    return fail(c, 500, 'internal_error');
  });

  return app;
}
