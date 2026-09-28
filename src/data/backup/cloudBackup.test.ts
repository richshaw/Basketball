import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase } from '@/test/db';
import { buildRealData, TEST_API_URL } from '@/test/backupHarness';
import { FakeBackupServer } from '@/test/fakeBackupServer';
import { createGame } from '../repo';
import { exportAll, importAll } from '../transfer';
import {
  backUpNow,
  disableCloudBackup,
  enableCloudBackup,
  enableCloudBackupWithCode,
  fetchCloudBackup,
  getBackupCode,
  getCloudBackupStatus,
  isCloudBackupAvailable,
  listCloudVersions,
  whenBackupIdle,
} from './cloudBackup';
import { createBackupApi } from './api';
import { generateBackupCode, parseBackupCode } from './code';
import { useCloudBackupStatus } from './hooks';
import { deriveBackupKeys } from './keys';
import { loadBackupState } from './state';

let server: FakeBackupServer;

beforeEach(() => {
  server = new FakeBackupServer();
  vi.stubEnv('VITE_BACKUP_API_URL', `${TEST_API_URL}/`);
  vi.stubGlobal('fetch', server.fetch);
});

afterEach(async () => {
  await whenBackupIdle();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Ten games of the parent's own. */
async function seedReal() {
  await importAll(buildRealData(), 'replace');
}

const withoutExportedAt = ({ exportedAt: _, ...rest }: { exportedAt: string }) => rest;

describe('cloud backup API', () => {
  it('is available only in builds with a backup server URL', () => {
    expect(isCloudBackupAvailable()).toBe(true);
    vi.stubEnv('VITE_BACKUP_API_URL', '');
    expect(isCloudBackupAvailable()).toBe(false);
    vi.stubEnv('VITE_BACKUP_API_URL', 'not a url');
    expect(isCloudBackupAvailable()).toBe(false);
    vi.stubEnv('VITE_BACKUP_API_URL', 'ftp://backup.example');
    expect(isCloudBackupAvailable()).toBe(false);
  });

  it('backs up, then restores on a new phone with the code', async () => {
    await seedReal();
    const original = await exportAll();
    const code = await enableCloudBackup();
    await whenBackupIdle();
    expect(await getBackupCode()).toBe(code);
    expect(server.uploads).toHaveLength(1);
    expect(await getCloudBackupStatus()).toMatchObject({ enabled: true, state: 'idle' });

    // A new phone: nothing on it, not even the code.
    await resetDatabase();
    expect(await getBackupCode()).toBeUndefined();
    const typed = code.toLowerCase().replace(/-/g, ' ');
    const fetched = await fetchCloudBackup(typed);
    if (!fetched.ok) throw new Error(fetched.error.message);
    expect(fetched.value).toMatchObject({ games: 10, version: server.uploads[0]?.version });
    expect(fetched.value.exportedAt).toBe(Date.parse(fetched.value.file.exportedAt));
    expect(withoutExportedAt(fetched.value.file)).toEqual(withoutExportedAt(original));

    await importAll(fetched.value.file, 'replace');
    const downloads = server.requests.filter(({ method }) => method === 'GET').length;
    expect(await enableCloudBackupWithCode(typed, { backup: fetched.value })).toEqual({
      ok: true,
      value: undefined,
    });
    await whenBackupIdle();
    // The fetched backup was reused, and this phone carries on backing up under the code.
    expect(server.requests.filter(({ method }) => method === 'GET')).toHaveLength(downloads);
    expect(server.uploads).toHaveLength(2);
    expect((await loadBackupState())?.backedUpGameIds).toHaveLength(10);
    expect(await loadBackupState()).toMatchObject({
      code,
      lastVersion: server.uploads[1]?.version,
    });

    const versions = await listCloudVersions(code);
    expect(versions.ok && versions.value.map(({ version }) => version)).toEqual(
      server.uploads.map(({ version }) => version).reverse(),
    );
    const first = await fetchCloudBackup(code, { version: server.uploads[0]?.version });
    expect(first.ok && first.value.games).toBe(10);
  });

  it("won't let a phone with little data replace the backup it switches to", async () => {
    await seedReal();
    const code = await enableCloudBackup();
    await whenBackupIdle();

    // A new phone with one game of its own, turned on with the old code but not restored.
    await resetDatabase();
    await createGame({ opponent: 'Lincoln', date: '2026-09-28', periodFormat: 'quarters' });
    expect((await enableCloudBackupWithCode(code)).ok).toBe(true);
    await whenBackupIdle();
    expect(server.uploads).toHaveLength(1);
    expect(await getCloudBackupStatus()).toMatchObject({
      state: 'paused-shrink',
      shrink: { backedUpGames: 10, missingGames: 10 },
    });
    expect((await backUpNow({ force: true })).ok).toBe(true);
    expect(server.uploads).toHaveLength(2);
  });

  it('explains codes that are mistyped or have no backup', async () => {
    const typo = await fetchCloudBackup('7K3M-9QXA');
    expect(typo).toEqual({
      ok: false,
      error: {
        kind: 'invalid-code',
        message:
          'That code is too short. A backup code has 28 letters and numbers, and this one has 8.',
      },
    });
    const unknown = generateBackupCode();
    expect(await fetchCloudBackup(unknown)).toEqual({
      ok: false,
      error: {
        kind: 'unauthorized',
        message: "There's no backup for this code. Check the code and try again.",
      },
    });
    expect(await enableCloudBackupWithCode(unknown)).toMatchObject({
      ok: false,
      error: { kind: 'unauthorized' },
    });
    expect(await listCloudVersions(unknown)).toMatchObject({
      ok: false,
      error: { kind: 'unauthorized' },
    });
    expect(await getBackupCode()).toBeUndefined();
  });

  it("calls a stored backup that won't decrypt damaged, since the code is right", async () => {
    const code = generateBackupCode();
    const keys = await deriveBackupKeys(parseBackupCode(code));
    const api = createBackupApi({ baseUrl: TEST_API_URL, fetch: server.fetch });
    await api.upload(keys, new Uint8Array(64).fill(7));
    expect(await fetchCloudBackup(code)).toEqual({
      ok: false,
      error: { kind: 'damaged', message: "This backup is damaged, so it can't be restored." },
    });
  });

  it('says why nothing happened when backup is off or unavailable', async () => {
    expect(await backUpNow()).toEqual({
      ok: false,
      error: { kind: 'not-enabled', message: 'Cloud backup is off.' },
    });
    expect(await disableCloudBackup()).toEqual({ ok: true, value: undefined });
    vi.stubEnv('VITE_BACKUP_API_URL', '');
    await expect(enableCloudBackup()).rejects.toThrow("isn't available");
    expect(await fetchCloudBackup(generateBackupCode())).toMatchObject({
      ok: false,
      error: { kind: 'unavailable' },
    });
  });

  it('turns off and deletes the cloud copy', async () => {
    await seedReal();
    const code = await enableCloudBackup();
    await whenBackupIdle();
    expect(await disableCloudBackup({ deleteCloudCopy: true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(server.accounts.size).toBe(0);
    expect(await getBackupCode()).toBeUndefined();
    expect(await fetchCloudBackup(code)).toMatchObject({
      ok: false,
      error: { kind: 'unauthorized' },
    });
  });
});

describe('useCloudBackupStatus', () => {
  it('loads, then follows turning backup on and each upload', async () => {
    await seedReal();
    const { result } = renderHook(() => useCloudBackupStatus());
    expect(result.current).toBeUndefined();
    await waitFor(() =>
      expect(result.current).toEqual({
        available: true,
        enabled: false,
        state: 'idle',
        pendingChanges: false,
      }),
    );

    const release = server.hold();
    await act(async () => {
      await enableCloudBackup();
    });
    await waitFor(() => expect(result.current?.state).toBe('backing-up'));
    expect(result.current).toMatchObject({ enabled: true, pendingChanges: true });

    release();
    await act(() => whenBackupIdle());
    await waitFor(() =>
      expect(result.current).toMatchObject({
        state: 'idle',
        pendingChanges: false,
        lastSuccessAt: expect.any(Number) as number,
      }),
    );
  });
});
