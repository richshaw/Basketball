import type { Context } from 'hono';
import { Hono } from 'hono';
import { hashToken, isHex64, parseBearer, tokenMatches } from './auth.js';
import type { AppConfig, Limits } from './config.js';
import { DEFAULT_LIMITS, DEFAULT_RETENTION } from './config.js';
import {
  clientKey,
  cors,
  describeError,
  ipRateLimit,
  redactIds,
  requestLogger,
  securityHeaders,
  tooManyRequests,
} from './middleware.js';
import { FixedWindowRateLimiter } from './rateLimit.js';
import type { RetentionPolicy } from './retention.js';
import { planRetention } from './retention.js';
import type { VersionRef } from './store.js';
import { BackupStore, BodyReadError, isErrno } from './store.js';
import { nextVersionId, parseVersionTime } from './versionId.js';

/** Options for {@link createApp}. Only `dataDir` is required; the rest have production defaults. */
export interface AppOptions {
  dataDir: string;
  allowedOrigins?: readonly string[];
  limits?: Partial<Limits>;
  retention?: Partial<RetentionPolicy>;
  now?: () => number;
  log?: (line: string) => void;
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
  | 'insufficient_storage'
  | 'internal_error';

type ErrorStatus = 400 | 401 | 404 | 413 | 500 | 507;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function fail(c: Context, status: ErrorStatus, error: ErrorCode): Response {
  // 401s advertise the scheme (RFC 6750); a bare "Bearer" never triggers a browser prompt.
  const headers: Record<string, string> = status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {};
  return c.json({ error }, status, headers);
}

const toIso = (ms: number): string => new Date(ms).toISOString();

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

function blobResponse(c: Context, ref: VersionRef, data: Buffer<ArrayBuffer>): Response {
  return c.body(data, 200, {
    'Content-Type': 'application/octet-stream',
    'X-Backup-Version': ref.version,
    'X-Backup-Created-At': toIso(ref.createdAtMs),
  });
}

export function createApp(options: AppOptions): Hono {
  const config: AppConfig = {
    dataDir: options.dataDir,
    allowedOrigins: options.allowedOrigins ?? [],
    limits: { ...DEFAULT_LIMITS, ...options.limits },
    retention: { ...DEFAULT_RETENTION, ...options.retention },
    now: options.now ?? Date.now,
    log: options.log ?? ((line: string) => console.log(line)),
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
  const newAccountLimiter = new FixedWindowRateLimiter(
    limits.newAccountsPerIpPerHour,
    HOUR_MS,
    config.now,
  );

  /**
   * Enumeration-safe check: an unknown account and a wrong token are indistinguishable (both
   * false, both answered with the same 401), so the API never confirms that an account exists.
   */
  async function isAuthorized(accountId: string, token: string): Promise<boolean> {
    const auth = await store.readAuth(accountId);
    return tokenMatches(token, auth?.tokenSha256 ?? null);
  }

  const app = new Hono();

  app.use(requestLogger(config.log));
  app.use(securityHeaders());
  app.use(cors(config.allowedOrigins));
  app.use(ipRateLimit(ipLimiter));

  app.get('/health', (c) => c.json({ ok: true }));

  // Upload a new version. First upload for an account claims it (trust on first use).
  app.put('/v1/backups/:accountId', async (c) => {
    const creds = readCredentials(c, c.req.param('accountId'));
    if (!creds.ok) return creds.response;
    const { accountId, token } = creds;

    // Refuse early when the client announces an oversized body; streaming enforces it anyway.
    if (Number(c.req.header('Content-Length')) > limits.maxBodyBytes) {
      return fail(c, 413, 'payload_too_large');
    }

    return store.withAccountLock(accountId, async () => {
      const auth = await store.readAuth(accountId);
      if (auth !== null && !tokenMatches(token, auth.tokenSha256)) {
        return fail(c, 401, 'unauthorized');
      }
      if (auth === null) {
        const decision = newAccountLimiter.hit(clientKey(c));
        if (!decision.allowed) return tooManyRequests(c, decision.retryAfterSeconds);
      }
      const decision = writeLimiter.hit(accountId);
      if (!decision.allowed) return tooManyRequests(c, decision.retryAfterSeconds);

      await store.removeStaleTempFiles(accountId);
      let upload;
      try {
        upload = await store.receiveUpload(accountId, c.req.raw.body, limits.maxBodyBytes);
      } catch (err) {
        if (auth === null) await store.removeEmptyAccountDirs(accountId);
        if (err instanceof BodyReadError) return fail(c, 400, 'body_read_failed');
        throw err;
      }
      if (upload.kind !== 'received') {
        if (auth === null) await store.removeEmptyAccountDirs(accountId);
        return upload.kind === 'too_large'
          ? fail(c, 413, 'payload_too_large')
          : fail(c, 400, 'empty_body');
      }

      let created: VersionRef;
      let existing: VersionRef[];
      try {
        if (auth === null) {
          await store.createAuth(accountId, {
            tokenSha256: hashToken(token),
            createdAt: toIso(config.now()),
          });
        }
        existing = await store.listVersionRefs(accountId);
        created = nextVersionId(config.now(), existing[0]?.version);
        await store.commitUpload(accountId, upload.tempPath, created.version);
      } catch (err) {
        await store.discardUpload(upload.tempPath);
        if (auth === null) await store.removeEmptyAccountDirs(accountId);
        throw err;
      }

      // The upload is durable now; pruning is housekeeping and must not turn it into an error.
      try {
        const plan = planRetention([created, ...existing], config.now(), config.retention);
        await store.deleteVersions(
          accountId,
          plan.remove.map((v) => v.version),
        );
      } catch (err) {
        config.log(`retention pruning failed: ${describeError(err)}`);
      }

      return c.json(
        { version: created.version, createdAt: toIso(created.createdAtMs), size: upload.size },
        201,
      );
    });
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
    const [newest] = await store.listVersionRefs(creds.accountId);
    if (newest === undefined) return fail(c, 404, 'not_found');
    const data = await store.readVersion(creds.accountId, newest.version);
    if (data === null) return fail(c, 404, 'not_found');
    return blobResponse(c, newest, data);
  });

  // A specific blob.
  app.get('/v1/backups/:accountId/:version', async (c) => {
    const creds = readCredentials(c, c.req.param('accountId'));
    if (!creds.ok) return creds.response;
    const version = c.req.param('version');
    const createdAtMs = parseVersionTime(version);
    if (createdAtMs === null) return fail(c, 400, 'invalid_version');
    if (!(await isAuthorized(creds.accountId, creds.token))) return fail(c, 401, 'unauthorized');
    const data = await store.readVersion(creds.accountId, version);
    if (data === null) return fail(c, 404, 'not_found');
    return blobResponse(c, { version, createdAtMs }, data);
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
