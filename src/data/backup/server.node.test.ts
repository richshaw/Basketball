// @vitest-environment node
/**
 * The backup client against the REAL server app (server/src/app.ts via its test
 * harness): in process, no sockets, a temp data directory. The same contract runs
 * against the in-memory fake the other tests use (src/test/fakeBackupServer.ts), which
 * keeps the fake honest for what both implement. The fake doesn't model retention,
 * rate limits or disk space; its 409 for an upload arriving during a delete is only
 * tested on its own (api.test.ts).
 *
 * Needs the server's dependencies (`npm ci --prefix server`). Without them the
 * real-server tests show up as skipped, except in CI, where that's an error.
 */
import { describe, expect, it } from 'vitest';
import { createEngineHarness } from '@/test/backupHarness';
import { FakeBackupServer } from '@/test/fakeBackupServer';
import { buildDemoData } from '../demo';
import { getSettings, updateSettings } from '../repo';
import { exportAll, importAll } from '../transfer';
import { createBackupApi, MAX_UPLOAD_BYTES } from './api';
import { generateBackupCode, generateBackupSecret, parseBackupCode } from './code';
import { deriveBackupKeys } from './keys';
import { decryptSnapshot, encryptSnapshot } from './snapshot';

/** The origin the real server (as its test harness sets it up) allows. */
const ORIGIN = 'https://richshaw.github.io';
const BASE = 'https://backup.hoop-stats.test';

interface ServerHarness {
  app: { fetch(request: Request): Response | Promise<Response> };
  cleanup(): Promise<void>;
}

/** The server's own dependencies aren't installed (`npm ci --prefix server`). */
function isMissingServerDependency(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND' &&
    /['"](hono|@hono\/node-server)['"]/.test(error.message)
  );
}

async function loadServerHarness(): Promise<(() => Promise<ServerHarness>) | undefined> {
  // A runtime URL, so TypeScript doesn't type-check the server's code with the app's settings.
  const helpers = new URL('../../../server/test/helpers.ts', import.meta.url).href;
  try {
    const module = (await import(/* @vite-ignore */ helpers)) as {
      createHarness(): Promise<ServerHarness>;
    };
    return () => module.createHarness();
  } catch (error) {
    // Only a missing dependency skips; anything else (a broken import) fails the run.
    if (import.meta.env.CI || !isMissingServerDependency(error)) throw error;
    return undefined;
  }
}

const createRealServer = await loadServerHarness();

interface Backend {
  fetch: typeof fetch;
  cleanup(): Promise<void>;
}

/** Every request comes from the app's origin, as in the browser. */
function fromApp(send: (request: Request) => Response | Promise<Response>): typeof fetch {
  return async (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Origin', ORIGIN);
    return send(new Request(input, { ...init, headers }));
  };
}

const backends: [string, (() => Promise<Backend>) | undefined][] = [
  [
    'the in-memory fake',
    () => {
      const fake = new FakeBackupServer({ allowedOrigins: [ORIGIN] });
      return Promise.resolve({ fetch: fake.fetch, cleanup: () => Promise.resolve() });
    },
  ],
  [
    'the real server',
    createRealServer &&
      (async () => {
        const server = await createRealServer();
        return {
          fetch: fromApp((request) => server.app.fetch(request)),
          cleanup: () => server.cleanup(),
        };
      }),
  ],
];

if (!createRealServer) {
  // Says why in the default output, next to the real-server tests below being skipped.
  describe('the real backup server', () => {
    it.skip('is skipped: its dependencies are missing (run "npm ci --prefix server")', () => {});
  });
}

describe.each(backends)('backup client against %s', (_name, createBackend) => {
  const test = it.skipIf(!createBackend);
  async function withBackend(run: (backend: Backend) => Promise<void>) {
    const backend = await createBackend!();
    try {
      await run(backend);
    } finally {
      await backend.cleanup();
    }
  }

  test('uploads, lists, downloads and deletes an encrypted snapshot', () =>
    withBackend(async (backend) => {
      const api = createBackupApi({ baseUrl: BASE, fetch: backend.fetch });
      const keys = await deriveBackupKeys(generateBackupSecret());
      const file = buildDemoData({ today: '2026-09-27' });
      const snapshot = await encryptSnapshot(file, keys);

      const uploaded = await api.upload(keys, snapshot);
      if (!uploaded.ok) throw new Error(uploaded.error.kind);
      expect(uploaded.value.size).toBe(snapshot.byteLength);
      expect(uploaded.value.version).toMatch(/^\d{10}-\d{8}T\d{9}Z$/);
      const second = await api.upload(keys, await encryptSnapshot(file, keys));
      expect(second.ok && second.value.version > uploaded.value.version).toBe(true);

      const listed = await api.list(keys);
      expect(listed.ok && listed.value.map(({ version }) => version)).toEqual([
        second.ok && second.value.version,
        uploaded.value.version,
      ]);
      const latest = await api.download(keys);
      if (!latest.ok) throw new Error(latest.error.kind);
      expect(latest.value.version).toBe(second.ok && second.value.version);
      expect(await decryptSnapshot(latest.value.bytes, keys)).toEqual(file);
      const first = await api.download(keys, uploaded.value.version);
      expect(first.ok && Array.from(first.value.bytes)).toEqual(Array.from(snapshot));

      expect(await api.deleteAll(keys)).toEqual({ ok: true, value: undefined });
      expect(await api.list(keys)).toMatchObject({ ok: false, error: { kind: 'unauthorized' } });
    }));

  test('answers with the errors the client expects', () =>
    withBackend(async (backend) => {
      const api = createBackupApi({ baseUrl: BASE, fetch: backend.fetch });
      const keys = await deriveBackupKeys(generateBackupSecret());
      expect(await api.download(keys)).toMatchObject({
        ok: false,
        error: { kind: 'unauthorized', status: 401 },
      });
      expect((await api.upload(keys, Uint8Array.of(1))).ok).toBe(true);

      const stranger = {
        ...keys,
        authToken: (await deriveBackupKeys(generateBackupSecret())).authToken,
      };
      expect(await api.upload(stranger, Uint8Array.of(2))).toMatchObject({
        ok: false,
        error: { kind: 'unauthorized', code: 'unauthorized' },
      });
      expect(await api.list(stranger)).toMatchObject({
        ok: false,
        error: { kind: 'unauthorized' },
      });
      expect(await api.download(keys, '0000000099-20260101T000000000Z')).toMatchObject({
        ok: false,
        error: { kind: 'not-found', code: 'not_found' },
      });
      expect(await api.upload(keys, new Uint8Array(MAX_UPLOAD_BYTES + 1))).toMatchObject({
        ok: false,
        error: { kind: 'too-large', status: 413 },
      });
    }));

  test("tells the newest version's id and size without the bytes (HEAD)", () =>
    withBackend(async (backend) => {
      const api = createBackupApi({ baseUrl: BASE, fetch: backend.fetch });
      const keys = await deriveBackupKeys(generateBackupSecret());
      expect(await api.latest(keys)).toMatchObject({
        ok: false,
        error: { kind: 'unauthorized', status: 401 },
      });
      await api.upload(keys, Uint8Array.of(1, 2, 3));
      const uploaded = await api.upload(keys, Uint8Array.of(4, 5, 6, 7, 8));
      if (!uploaded.ok) throw new Error(uploaded.error.kind);
      expect(await api.latest(keys)).toEqual({
        ok: true,
        value: { version: uploaded.value.version, createdAt: uploaded.value.createdAt, size: 5 },
      });
    }));

  test('allows 3 new accounts a day, then asks to wait', () =>
    withBackend(async (backend) => {
      const api = createBackupApi({ baseUrl: BASE, fetch: backend.fetch });
      for (let i = 0; i < 3; i += 1) {
        const keys = await deriveBackupKeys(generateBackupSecret());
        expect((await api.upload(keys, Uint8Array.of(i + 1))).ok).toBe(true);
      }
      const keys = await deriveBackupKeys(generateBackupSecret());
      expect(await api.upload(keys, Uint8Array.of(9))).toMatchObject({
        ok: false,
        error: { kind: 'rate-limited', status: 429, retryAfterMs: 24 * 60 * 60 * 1000 },
      });
    }));

  test('lets the app read its headers across origins', () =>
    withBackend(async (backend) => {
      const keys = await deriveBackupKeys(generateBackupSecret());
      const api = createBackupApi({ baseUrl: BASE, fetch: backend.fetch });
      await api.upload(keys, Uint8Array.of(1, 2, 3));
      const response = await backend.fetch(`${BASE}/v1/backups/${keys.accountId}/latest`, {
        headers: { Authorization: `Bearer ${keys.authToken}`, Origin: ORIGIN },
      });
      await response.arrayBuffer();
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
      const exposed = response.headers.get('Access-Control-Expose-Headers') ?? '';
      for (const header of ['X-Backup-Version', 'X-Backup-Created-At', 'Retry-After']) {
        expect(exposed).toContain(header);
      }
    }));

  test('backs up and restores end to end through the engine', () =>
    withBackend(async (backend) => {
      const h = createEngineHarness({ fetch: backend.fetch });
      await importAll(buildDemoData({ today: '2026-09-27' }), 'replace');
      const code = await h.engine.enable();
      await h.settle();
      h.engine.start();
      await h.notify();
      await updateSettings({ shotChart: !(await getSettings()).shotChart });
      await h.notify();
      await h.advance(60_000);

      const versions = await h.engine.listVersions(code);
      expect(versions.ok && versions.value).toHaveLength(2);
      const restored = await h.engine.fetchBackup(code);
      if (!restored.ok) throw new Error(restored.error.message);
      const { exportedAt: _, ...current } = await exportAll();
      const { exportedAt: __, ...backedUp } = restored.value.file;
      expect(backedUp).toEqual(current);

      expect(await h.engine.fetchBackup(generateBackupCode())).toMatchObject({
        ok: false,
        error: { kind: 'unauthorized', message: expect.stringContaining('no backup') as string },
      });
      expect(await h.engine.disable({ deleteCloudCopy: true })).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await h.engine.listVersions(code)).toMatchObject({
        ok: false,
        error: { kind: 'unauthorized' },
      });
      h.engine.stop();
      expect(parseBackupCode(code)).toHaveLength(16);
    }));
});
