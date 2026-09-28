/**
 * Client for the backup server's HTTP API (see server/README.md). Every call resolves
 * to a typed result and never throws: a failure is an `ApiError` whose `kind` says
 * what happened (and so what to do about it), never a raw exception.
 *
 * Requests carry no cookies or other credentials beyond the bearer token, are never
 * cached, and give up after `timeoutMs` (30 s by default: the server sleeps when
 * idle and can take a few seconds to wake up).
 */

export interface BackupCredentials {
  /** 64 lowercase hex characters. */
  accountId: string;
  /** 64 lowercase hex characters. */
  authToken: string;
}

/** One stored snapshot, as the server describes it. */
export interface BackupVersion {
  /** Opaque id, e.g. '0000000042-20260928T041523123Z'. Later uploads sort higher. */
  version: string;
  /** When the upload started (epoch ms, server clock). */
  createdAt: number;
  /** Size in bytes (encrypted). */
  size: number;
}

export interface DownloadedSnapshot {
  bytes: Uint8Array<ArrayBuffer>;
  /** From the X-Backup-Version header. */
  version?: string;
  /** From the X-Backup-Created-At header (epoch ms, server clock). */
  createdAt?: number;
}

export type ApiErrorKind =
  /** The phone is offline (navigator.onLine is false). Nothing was sent. */
  | 'offline'
  /** No answer: no signal, DNS, TLS or CORS trouble, or the server is down. */
  | 'network'
  /** No answer in time (our timeout, or the server's 408 for a stalled upload). */
  | 'timeout'
  /** 401: no account for these credentials, or a token it doesn't accept. */
  | 'unauthorized'
  /** 404: no backup stored yet, or no such version. */
  | 'not-found'
  /** 409: the account was deleted while this upload was arriving. Nothing was stored. */
  | 'account-deleted'
  /** 413: bigger than the server accepts. */
  | 'too-large'
  /** 429: too many requests; wait `retryAfterMs`. */
  | 'rate-limited'
  /** 503: too many uploads at once; wait `retryAfterMs`. */
  | 'server-busy'
  /** 507 insufficient_storage: the server's disk is (nearly) full. */
  | 'server-full'
  /** 507 account_limit_reached: the server has no room for another account. */
  | 'account-limit'
  /** 400: a malformed request, or an upload that broke off. */
  | 'bad-request'
  /** The caller cancelled the request (its AbortSignal). */
  | 'aborted'
  /** 500, or any answer this client doesn't understand. */
  | 'server-error';

export interface ApiError {
  kind: ApiErrorKind;
  /** The HTTP status, when the server answered. */
  status?: number;
  /** The server's error code, e.g. 'account_limit_reached'. */
  code?: string;
  /** How long the server asked us to wait (Retry-After), in ms. */
  retryAfterMs?: number;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export interface BackupApiOptions {
  /** e.g. 'https://richshaw-hoop-stats.fly.dev' (a trailing slash is fine). */
  baseUrl: string;
  /** Defaults to the global fetch, looked up on each call. */
  fetch?: typeof fetch;
  /** Per request, including reading the body. Default 30 s. */
  timeoutMs?: number;
  /** Defaults to `navigator.onLine` (true where there's no navigator). */
  isOnline?: () => boolean;
  /** For Retry-After dates. Defaults to Date.now. */
  now?: () => number;
}

export interface RequestOptions {
  /** Cancels the request; it then resolves to an 'aborted' error. */
  signal?: AbortSignal;
}

export interface BackupApi {
  /** PUT: stores a new version. */
  upload(
    credentials: BackupCredentials,
    snapshot: Uint8Array<ArrayBuffer>,
    options?: RequestOptions,
  ): Promise<ApiResult<BackupVersion>>;
  /** GET: every stored version, newest first. */
  list(
    credentials: BackupCredentials,
    options?: RequestOptions,
  ): Promise<ApiResult<BackupVersion[]>>;
  /** GET: the newest snapshot, or the given version. */
  download(
    credentials: BackupCredentials,
    version?: string,
    options?: RequestOptions,
  ): Promise<ApiResult<DownloadedSnapshot>>;
  /** DELETE: the account and every version. */
  deleteAll(credentials: BackupCredentials, options?: RequestOptions): Promise<ApiResult<void>>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** The server's upload limit (MAX_BODY_BYTES): 5 MiB. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Never wait longer than a day, whatever Retry-After says. */
const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const HEX_64 = /^[0-9a-f]{64}$/;
const VERSION_ID = /^\d{10}-\d{8}T\d{9}Z$/;

function failure<T>(kind: ApiErrorKind, details: Omit<ApiError, 'kind'> = {}): ApiResult<T> {
  return { ok: false, error: { kind, ...details } };
}

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Retry-After (seconds, or an HTTP date) in ms, capped at a day; undefined if absent. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  const ms = /^\d+$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  if (Number.isNaN(ms)) return undefined;
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

function kindForStatus(status: number, code: string | undefined): ApiErrorKind {
  switch (status) {
    case 400:
      return 'bad-request';
    case 401:
      return 'unauthorized';
    case 404:
      return 'not-found';
    case 408:
      return 'timeout';
    case 409:
      return 'account-deleted';
    case 413:
      return 'too-large';
    case 429:
      return 'rate-limited';
    case 503:
      return 'server-busy';
    case 507:
      return code === 'account_limit_reached' ? 'account-limit' : 'server-full';
    default:
      return 'server-error';
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A version as the server lists it ({ version, createdAt: ISO, size }), or undefined. */
function parseVersion(value: unknown): BackupVersion | undefined {
  if (!isRecord(value)) return undefined;
  const { version, createdAt, size } = value;
  if (typeof version !== 'string' || typeof createdAt !== 'string') return undefined;
  if (typeof size !== 'number' || !Number.isFinite(size)) return undefined;
  const createdAtMs = Date.parse(createdAt);
  if (!version || Number.isNaN(createdAtMs)) return undefined;
  return { version, createdAt: createdAtMs, size };
}

const unexpectedResponse = <T>(status: number) =>
  failure<T>('server-error', { status, code: 'unexpected_response' });

export function createBackupApi(options: BackupApiOptions): BackupApi {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const now = options.now ?? Date.now;

  async function errorFrom<T>(response: Response): Promise<ApiResult<T>> {
    const body = await readJson(response);
    const code = isRecord(body) && typeof body.error === 'string' ? body.error : undefined;
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), now());
    const details: Omit<ApiError, 'kind'> = { status: response.status };
    if (code !== undefined) details.code = code;
    if (retryAfterMs !== undefined) details.retryAfterMs = retryAfterMs;
    return failure(kindForStatus(response.status, code), details);
  }

  /**
   * One request: checks the credentials and the connection first, then fetches and
   * reads the answer (`read` handles 2xx answers) within the timeout.
   */
  async function send<T>(
    credentials: BackupCredentials,
    init: { method: string; path?: string; body?: Uint8Array<ArrayBuffer> },
    read: (response: Response) => Promise<ApiResult<T>>,
    external: AbortSignal | undefined,
  ): Promise<ApiResult<T>> {
    // A malformed id or token is a bug here, and must never reach the server (or its logs).
    if (!HEX_64.test(credentials.accountId) || !HEX_64.test(credentials.authToken)) {
      return failure('bad-request', { code: 'invalid_credentials' });
    }
    if (external?.aborted) return failure('aborted');
    if (!isOnline()) return failure('offline');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const cancel = () => controller.abort();
    external?.addEventListener('abort', cancel);
    // Settles as soon as the request is aborted, even if `fetch` ignores its signal.
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });

    const url = `${baseUrl}/v1/backups/${credentials.accountId}${init.path ?? ''}`;
    const headers: Record<string, string> = { Authorization: `Bearer ${credentials.authToken}` };
    if (init.body) headers['Content-Type'] = 'application/octet-stream';
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const work = (async () => {
      const response = await fetchImpl(url, {
        method: init.method,
        headers,
        body: init.body,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      return response.ok ? read(response) : errorFrom<T>(response);
    })();
    // Whichever loses the race below must not become an unhandled rejection.
    work.catch(() => undefined);
    aborted.catch(() => undefined);

    try {
      return await Promise.race([work, aborted]);
    } catch {
      if (timedOut) return failure('timeout');
      if (external?.aborted) return failure('aborted');
      return failure(isOnline() ? 'network' : 'offline');
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', cancel);
    }
  }

  return {
    upload(credentials, snapshot, requestOptions = {}) {
      return send(
        credentials,
        { method: 'PUT', body: snapshot },
        async (response) => {
          const version = parseVersion(await readJson(response));
          return version ? { ok: true, value: version } : unexpectedResponse(response.status);
        },
        requestOptions.signal,
      );
    },

    list(credentials, requestOptions = {}) {
      return send(
        credentials,
        { method: 'GET' },
        async (response) => {
          const body = await readJson(response);
          const listed = isRecord(body) && Array.isArray(body.versions) ? body.versions : undefined;
          const versions = listed?.map(parseVersion);
          if (!versions || versions.some((version) => version === undefined)) {
            return unexpectedResponse(response.status);
          }
          return { ok: true, value: versions as BackupVersion[] };
        },
        requestOptions.signal,
      );
    },

    download(credentials, version, requestOptions = {}) {
      if (version !== undefined && !VERSION_ID.test(version)) {
        return Promise.resolve(failure('bad-request', { code: 'invalid_version' }));
      }
      return send(
        credentials,
        { method: 'GET', path: `/${version ?? 'latest'}` },
        async (response) => {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const snapshot: DownloadedSnapshot = { bytes };
          const versionHeader = response.headers.get('X-Backup-Version');
          const createdAt = Date.parse(response.headers.get('X-Backup-Created-At') ?? '');
          if (versionHeader) snapshot.version = versionHeader;
          if (!Number.isNaN(createdAt)) snapshot.createdAt = createdAt;
          return { ok: true, value: snapshot };
        },
        requestOptions.signal,
      );
    },

    deleteAll(credentials, requestOptions = {}) {
      return send(
        credentials,
        { method: 'DELETE' },
        async (response) => {
          await response.body?.cancel();
          return { ok: true, value: undefined };
        },
        requestOptions.signal,
      );
    },
  };
}
