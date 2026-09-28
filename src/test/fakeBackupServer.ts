/**
 * An in-memory stand-in for the backup server (server/), for unit and e2e tests. It
 * follows server/README.md: the same routes (HEAD included), status codes, error
 * bodies and headers (CORS included), trust-on-first-use accounts, the account caps
 * (5 in all, 3 new a day), and 409 for an upload still arriving when its account is
 * deleted. It doesn't model retention (it keeps every version), per-IP or
 * per-account rate limits, or disk space. src/data/backup/server.node.test.ts runs a
 * shared contract against it and the real server for the parts both implement.
 *
 * No imports and no app aliases: e2e specs import it too.
 */

export interface FakeRequest {
  method: string;
  url: string;
  /** Header names in lowercase. */
  headers: Record<string, string>;
  body?: Uint8Array | null;
}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer> | null;
}

/** An error answer to give instead of the real one (see failNext). */
export interface FakeFailure {
  status: number;
  /** The `error` code in the JSON body. */
  error?: string;
  retryAfterSeconds?: number;
  /** Only for requests with this method (e.g. 'PUT'). */
  method?: string;
}

export interface FakeUpload {
  accountId: string;
  version: string;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface FakeBackupServerOptions {
  /** Server clock (epoch ms). Defaults to Date.now. */
  now?: () => number;
  /** Origins that get CORS headers; '*' allows any. Default: none. */
  allowedOrigins?: readonly string[];
  /** Upload limit in bytes. Default 5 MiB. */
  maxBodyBytes?: number;
  /** Accounts the server holds at most. Default 5. */
  maxAccounts?: number;
  /** New accounts per rolling 24 hours. Default 3. */
  maxNewAccountsPerDay?: number;
}

interface Version {
  version: string;
  createdAt: number;
  bytes: Uint8Array<ArrayBuffer>;
}

interface Account {
  token: string;
  sequence: number;
  versions: Version[];
}

const HEX_64 = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const VERSION_ID = /^\d{10}-\d{8}T\d{9}Z$/;
const EXPOSED_HEADERS = 'X-Backup-Version, X-Backup-Created-At, Retry-After';
const encoder = new TextEncoder();

function json(status: number, body: unknown, headers: Record<string, string> = {}): FakeResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: encoder.encode(JSON.stringify(body)),
  };
}

function fail(status: number, error: string, retryAfterSeconds?: number): FakeResponse {
  const headers: Record<string, string> = {};
  if (status === 401) headers['WWW-Authenticate'] = 'Bearer';
  if (retryAfterSeconds !== undefined) headers['Retry-After'] = String(retryAfterSeconds);
  return json(status, { error }, headers);
}

function versionId(sequence: number, createdAt: number): string {
  const time = new Date(createdAt).toISOString().replace(/[-:.]/g, '');
  return `${String(sequence).padStart(10, '0')}-${time}`;
}

function toBytes(body: unknown): Uint8Array | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return encoder.encode(body);
  if (ArrayBuffer.isView(body))
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  throw new TypeError('FakeBackupServer only takes string or byte bodies');
}

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  if (!headers) return record;
  const entries: Iterable<[string, string]> =
    headers instanceof Headers
      ? headers.entries()
      : Array.isArray(headers)
        ? headers
        : Object.entries(headers);
  for (const [name, value] of entries) record[name.toLowerCase()] = value;
  return record;
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export class FakeBackupServer {
  readonly accounts = new Map<string, Account>();
  /** Every request received, in order (answered or not). */
  readonly requests: { method: string; path: string }[] = [];
  /** Every stored upload, in order. */
  readonly uploads: FakeUpload[] = [];
  /** Requests being answered right now, and the most there ever were at once. */
  inFlight = 0;
  maxInFlight = 0;
  /** While true, every request fails like a dropped connection. */
  networkDown = false;
  /**
   * The next request of this method is handled (an upload is stored), but its answer
   * is lost, like a connection that drops just before the response.
   */
  loseNextAnswer: string | undefined;

  private readonly now: () => number;
  private readonly allowedOrigins: readonly string[];
  private readonly maxBodyBytes: number;
  private readonly maxAccounts: number;
  private readonly maxNewAccountsPerDay: number;
  /** When each account was created (for the daily cap). */
  private readonly creations: number[] = [];
  /** Deletes per account id, so an upload that was arriving meanwhile gets a 409. */
  private readonly deletions = new Map<string, number>();
  private readonly failures: FakeFailure[] = [];
  private gate: Promise<void> | undefined;

  constructor(options: FakeBackupServerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.allowedOrigins = options.allowedOrigins ?? [];
    this.maxBodyBytes = options.maxBodyBytes ?? 5 * 1024 * 1024;
    this.maxAccounts = options.maxAccounts ?? 5;
    this.maxNewAccountsPerDay = options.maxNewAccountsPerDay ?? 3;
  }

  /** Answers the next matching request with this error instead. Queue several in order. */
  failNext(failure: FakeFailure): void {
    this.failures.push(failure);
  }

  /** Holds every answer until the returned function is called (to test in-flight uploads). */
  hold(): () => void {
    let release = () => {};
    this.gate = new Promise<void>((resolve) => {
      release = () => {
        this.gate = undefined;
        resolve();
      };
    });
    return release;
  }

  /** Number of uploads (PUTs) received, whatever the answer. */
  get putCount(): number {
    return this.requests.filter((request) => request.method === 'PUT').length;
  }

  /** The backup server's answer to one request (synchronous). */
  handle(request: FakeRequest): FakeResponse {
    this.record(request);
    return this.respond(request);
  }

  private record(request: FakeRequest): void {
    this.requests.push({
      method: request.method.toUpperCase(),
      path: new URL(request.url).pathname,
    });
  }

  /** Deletes so far for the account a request is about (see `respond`). */
  private deletionsFor(url: string): number {
    const accountId = /^\/v1\/backups\/([^/]+)/.exec(new URL(url).pathname)?.[1] ?? '';
    return this.deletions.get(accountId) ?? 0;
  }

  /** `arrivedAfter`: deletes of the account when the request arrived (default: now). */
  private respond(request: FakeRequest, arrivedAfter?: number): FakeResponse {
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    const origin = request.headers.origin;
    const originAllowed =
      origin !== undefined &&
      (this.allowedOrigins.includes('*') || this.allowedOrigins.includes(origin));
    if (method === 'OPTIONS') {
      if (origin === undefined) {
        return { status: 204, headers: { Allow: 'GET, PUT, DELETE, OPTIONS' }, body: null };
      }
      if (!originAllowed) return json(403, { error: 'origin_not_allowed' }, { Vary: 'Origin' });
      return {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
        body: null,
      };
    }

    // Injected failures match the method as sent (HEAD included).
    const injected = pathname.startsWith('/v1/') ? this.takeFailure(method) : undefined;
    // Like the real server (Hono), HEAD is GET without the body.
    const response = injected
      ? fail(injected.status, injected.error ?? 'injected', injected.retryAfterSeconds)
      : this.route(method === 'HEAD' ? 'GET' : method, pathname, request, arrivedAfter);
    if (method === 'HEAD') response.body = null;
    response.headers['Cache-Control'] = 'no-store';
    response.headers.Vary = 'Origin';
    if (originAllowed) {
      response.headers['Access-Control-Allow-Origin'] = origin;
      response.headers['Access-Control-Expose-Headers'] = EXPOSED_HEADERS;
    }
    return response;
  }

  /** A `fetch` that answers from this server, e.g. for vi.stubGlobal('fetch', server.fetch). */
  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const signal = init.signal ?? undefined;
    if (signal?.aborted) throw abortError();
    const request: FakeRequest = {
      method: init.method ?? 'GET',
      url,
      headers: headerRecord(init.headers),
      body: toBytes(init.body),
    };
    // Counted on arrival, so held and abandoned requests count too.
    this.record(request);
    const arrivedAfter = this.deletionsFor(url);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) {
        const gate = this.gate;
        await new Promise<void>((resolve, reject) => {
          signal?.addEventListener('abort', () => reject(abortError()));
          void gate.then(resolve);
        });
      }
      if (this.networkDown) throw new TypeError('Failed to fetch');
      const response = this.respond(request, arrivedAfter);
      if (this.loseNextAnswer === request.method.toUpperCase()) {
        this.loseNextAnswer = undefined;
        throw new TypeError('Failed to fetch');
      }
      return new Response(response.body, { status: response.status, headers: response.headers });
    } finally {
      this.inFlight -= 1;
    }
  };

  private takeFailure(method: string): FakeFailure | undefined {
    const index = this.failures.findIndex(
      (failure) => !failure.method || failure.method === method,
    );
    return index === -1 ? undefined : this.failures.splice(index, 1)[0];
  }

  private route(
    method: string,
    pathname: string,
    request: FakeRequest,
    arrivedAfter: number | undefined,
  ): FakeResponse {
    if (pathname === '/health' && method === 'GET') return json(200, { ok: true });
    const match = /^\/v1\/backups\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
    const accountId = match?.[1];
    if (!match || accountId === undefined) return fail(404, 'not_found');
    const sub = match[2];

    if (!HEX_64.test(accountId)) return fail(400, 'invalid_account_id');
    const authorization = request.headers.authorization?.trim();
    if (!authorization) return fail(401, 'missing_token');
    const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
    if (token === undefined || !HEX_64.test(token)) return fail(400, 'invalid_token');
    const account = this.accounts.get(accountId);
    const authorized = account !== undefined && account.token === token;

    if (method === 'PUT' && sub === undefined) {
      if (Number(request.headers['content-length']) > this.maxBodyBytes) {
        return fail(413, 'payload_too_large');
      }
      if (account && !authorized) return fail(401, 'unauthorized');
      const now = this.now();
      if (!account) {
        if (this.accounts.size >= this.maxAccounts) return fail(507, 'account_limit_reached');
        const recent = this.creations.filter((at) => at > now - DAY_MS);
        const oldest = recent[recent.length - this.maxNewAccountsPerDay];
        if (oldest !== undefined) {
          return fail(429, 'rate_limited', Math.max(1, Math.ceil((oldest + DAY_MS - now) / 1000)));
        }
      }
      const body = request.body ?? new Uint8Array(0);
      if (body.byteLength === 0) return fail(400, 'empty_body');
      if (body.byteLength > this.maxBodyBytes) return fail(413, 'payload_too_large');
      // Deleted while this upload was arriving: never bring the account back.
      if (arrivedAfter !== undefined && (this.deletions.get(accountId) ?? 0) !== arrivedAfter) {
        return fail(409, 'account_deleted');
      }
      if (!account) this.creations.push(now);
      const stored = account ?? { token, sequence: 0, versions: [] };
      this.accounts.set(accountId, stored);
      stored.sequence += 1;
      const createdAt = Math.floor(now);
      const version = versionId(stored.sequence, createdAt);
      const bytes = new Uint8Array(body);
      stored.versions.push({ version, createdAt, bytes });
      this.uploads.push({ accountId, version, bytes });
      return json(201, {
        version,
        createdAt: new Date(createdAt).toISOString(),
        size: bytes.byteLength,
      });
    }

    if (method === 'GET' && sub !== undefined && sub !== 'latest' && !VERSION_ID.test(sub)) {
      return fail(400, 'invalid_version');
    }
    if (method !== 'GET' && method !== 'DELETE') return fail(404, 'not_found');
    if (method === 'DELETE' && sub !== undefined) return fail(404, 'not_found');
    if (method === 'DELETE') {
      // Uploads still arriving must not land afterwards, even the account's first one.
      if (authorized || !account)
        this.deletions.set(accountId, (this.deletions.get(accountId) ?? 0) + 1);
      if (!account || !authorized) return fail(401, 'unauthorized');
      this.accounts.delete(accountId);
      return { status: 204, headers: {}, body: null };
    }
    if (!account || !authorized) return fail(401, 'unauthorized');
    const newestFirst = [...account.versions].sort((a, b) => (a.version < b.version ? 1 : -1));
    if (sub === undefined) {
      return json(200, {
        versions: newestFirst.map(({ version, createdAt, bytes }) => ({
          version,
          createdAt: new Date(createdAt).toISOString(),
          size: bytes.byteLength,
        })),
      });
    }
    const found =
      sub === 'latest' ? newestFirst[0] : newestFirst.find(({ version }) => version === sub);
    if (!found) return fail(404, 'not_found');
    return {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(found.bytes.byteLength),
        'X-Backup-Version': found.version,
        'X-Backup-Created-At': new Date(found.createdAt).toISOString(),
      },
      body: new Uint8Array(found.bytes),
    };
  }
}
