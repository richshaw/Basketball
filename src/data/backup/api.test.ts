import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeBackupServer } from '@/test/fakeBackupServer';
import { createBackupApi, parseRetryAfter, type ApiErrorKind, type BackupApi } from './api';

const BASE = 'https://backup.hoop-stats.test';
const CREDENTIALS = { accountId: 'a'.repeat(64), authToken: 'b'.repeat(64) };
const NOW = Date.UTC(2026, 8, 28, 12);

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function apiAnswering(response: () => Response | Promise<Response>, online = true) {
  const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(response()),
  );
  const api = createBackupApi({ baseUrl: BASE, fetch, isOnline: () => online, now: () => NOW });
  return { api, fetch };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('backup server API client', () => {
  it('uploads, lists, downloads and deletes', async () => {
    const server = new FakeBackupServer({ now: () => NOW });
    const api: BackupApi = createBackupApi({ baseUrl: `${BASE}/`, fetch: server.fetch });

    const uploaded = await api.upload(CREDENTIALS, Uint8Array.of(1, 2, 3));
    expect(uploaded).toEqual({
      ok: true,
      value: { version: '0000000001-20260928T120000000Z', createdAt: NOW, size: 3 },
    });
    await api.upload(CREDENTIALS, Uint8Array.of(4, 5));

    const listed = await api.list(CREDENTIALS);
    expect(listed.ok && listed.value.map((version) => version.size)).toEqual([2, 3]);

    const latest = await api.download(CREDENTIALS);
    expect(latest.ok && Array.from(latest.value.bytes)).toEqual([4, 5]);
    expect(latest.ok && latest.value).toMatchObject({
      version: '0000000002-20260928T120000000Z',
      createdAt: NOW,
    });
    const first = await api.download(CREDENTIALS, '0000000001-20260928T120000000Z');
    expect(first.ok && Array.from(first.value.bytes)).toEqual([1, 2, 3]);

    expect(await api.deleteAll(CREDENTIALS)).toEqual({ ok: true, value: undefined });
    expect(await api.list(CREDENTIALS)).toEqual({
      ok: false,
      error: { kind: 'unauthorized', status: 401, code: 'unauthorized' },
    });
    expect(server.requests.map(({ method, path }) => `${method} ${path}`)).toContain(
      `PUT /v1/backups/${CREDENTIALS.accountId}`,
    );
  });

  it('sends the token, no cookies, and never uses the cache', async () => {
    const { api, fetch } = apiAnswering(() =>
      jsonResponse(201, { version: 'v', createdAt: new Date(NOW).toISOString(), size: 1 }),
    );
    await api.upload(CREDENTIALS, Uint8Array.of(9));
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/v1/backups/${CREDENTIALS.accountId}`);
    expect(init).toMatchObject({
      method: 'PUT',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: `Bearer ${CREDENTIALS.authToken}`,
        'Content-Type': 'application/octet-stream',
      },
    });
    expect(Array.from(init?.body as Uint8Array)).toEqual([9]);
  });

  it.each<[number, string | undefined, ApiErrorKind]>([
    [400, 'body_read_failed', 'bad-request'],
    [401, 'unauthorized', 'unauthorized'],
    [401, 'missing_token', 'unauthorized'],
    [404, 'not_found', 'not-found'],
    [408, 'upload_stalled', 'timeout'],
    [409, 'account_deleted', 'account-deleted'],
    [413, 'payload_too_large', 'too-large'],
    [500, 'internal_error', 'server-error'],
    [502, undefined, 'server-error'],
    [507, 'insufficient_storage', 'server-full'],
    [507, 'account_limit_reached', 'account-limit'],
  ])('maps %i %s to %s', async (status, code, kind) => {
    const { api } = apiAnswering(() =>
      code === undefined
        ? new Response('<html>Bad gateway</html>', { status })
        : jsonResponse(status, { error: code }),
    );
    const result = await api.upload(CREDENTIALS, Uint8Array.of(1));
    expect(result).toEqual({
      ok: false,
      error: code === undefined ? { kind, status } : { kind, status, code },
    });
  });

  it('passes on how long the server asked to wait', async () => {
    const limited = apiAnswering(() =>
      jsonResponse(429, { error: 'rate_limited' }, { 'Retry-After': '30' }),
    );
    expect(await limited.api.list(CREDENTIALS)).toEqual({
      ok: false,
      error: { kind: 'rate-limited', status: 429, code: 'rate_limited', retryAfterMs: 30_000 },
    });
    const busy = apiAnswering(() =>
      jsonResponse(
        503,
        { error: 'server_busy' },
        {
          'Retry-After': new Date(NOW + 90_000).toUTCString(),
        },
      ),
    );
    const result = await busy.api.upload(CREDENTIALS, Uint8Array.of(1));
    expect(!result.ok && result.error).toMatchObject({ kind: 'server-busy', retryAfterMs: 90_000 });
  });

  it('reads Retry-After as seconds or a date, capped at a day', () => {
    expect(parseRetryAfter('5', NOW)).toBe(5000);
    expect(parseRetryAfter(' 0 ', NOW)).toBe(0);
    expect(parseRetryAfter(new Date(NOW + 60_000).toUTCString(), NOW)).toBe(60_000);
    expect(parseRetryAfter(new Date(NOW - 60_000).toUTCString(), NOW)).toBe(0);
    expect(parseRetryAfter('999999', NOW)).toBe(24 * 60 * 60 * 1000);
    expect(parseRetryAfter('soon', NOW)).toBeUndefined();
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
  });

  it("doesn't send anything while offline", async () => {
    const { api, fetch } = apiAnswering(() => jsonResponse(200, { versions: [] }), false);
    expect(await api.list(CREDENTIALS)).toEqual({ ok: false, error: { kind: 'offline' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns a failed fetch into a network error', async () => {
    let online = true;
    const fetch = vi.fn(() => {
      online = false;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    const api = createBackupApi({ baseUrl: BASE, fetch, isOnline: () => online });
    expect(await api.list(CREDENTIALS)).toEqual({ ok: false, error: { kind: 'offline' } });
    online = true;
    const flaky = createBackupApi({
      baseUrl: BASE,
      fetch: () => Promise.reject(new TypeError('Load failed')),
    });
    expect(await flaky.list(CREDENTIALS)).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('gives up after the timeout, even if fetch ignores the abort', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const api = createBackupApi({
      baseUrl: BASE,
      timeoutMs: 30_000,
      fetch: (_input, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    });
    const result = api.upload(CREDENTIALS, Uint8Array.of(1));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: false, error: { kind: 'timeout' } });
    expect(signal?.aborted).toBe(true);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    const api = createBackupApi({ baseUrl: BASE, fetch: () => new Promise<Response>(() => {}) });
    const result = api.upload(CREDENTIALS, Uint8Array.of(1), { signal: controller.signal });
    controller.abort();
    expect(await result).toEqual({ ok: false, error: { kind: 'aborted' } });
    expect(await api.list(CREDENTIALS, { signal: controller.signal })).toEqual({
      ok: false,
      error: { kind: 'aborted' },
    });
  });

  it('never sends malformed ids, tokens or versions', async () => {
    const { api, fetch } = apiAnswering(() => jsonResponse(200, { versions: [] }));
    expect(await api.list({ ...CREDENTIALS, accountId: 'A'.repeat(64) })).toEqual({
      ok: false,
      error: { kind: 'bad-request', code: 'invalid_credentials' },
    });
    expect(await api.download(CREDENTIALS, '../latest')).toEqual({
      ok: false,
      error: { kind: 'bad-request', code: 'invalid_version' },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('treats an answer it does not understand as a server error', async () => {
    const { api } = apiAnswering(() => new Response('ok', { status: 201 }));
    expect(await api.upload(CREDENTIALS, Uint8Array.of(1))).toEqual({
      ok: false,
      error: { kind: 'server-error', status: 201, code: 'unexpected_response' },
    });
    const list = apiAnswering(() => jsonResponse(200, { versions: [{ version: 'x' }] }));
    expect(await list.api.list(CREDENTIALS)).toMatchObject({
      ok: false,
      error: { kind: 'server-error' },
    });
  });
});
