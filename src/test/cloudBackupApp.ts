/**
 * The app's own cloud backup (the engine behind src/data/backup/cloudBackup.ts) talking
 * to an in-memory fake server, for screen tests, plus helpers that put it in each state
 * the screens show. The scheduler isn't started, so nothing uploads on its own: only
 * turning backup on and backUpNow do, and `whenBackupIdle()` waits for them.
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { createBackupApi } from '@/data/backup/api';
import {
  backUpNow,
  enableCloudBackup,
  getCloudBackupStatus,
  whenBackupIdle,
  type CloudBackupStatus,
} from '@/data/backup/cloudBackup';
import { parseBackupCode } from '@/data/backup/code';
import { deriveBackupKeys } from '@/data/backup/keys';
import { encryptSnapshot } from '@/data/backup/snapshot';
import type { DemoOptions } from '@/data/demo';
import { clearAllData, importAll, type ExportFile } from '@/data/transfer';
import { buildRealData, TEST_API_URL } from './backupHarness';
import { FakeBackupServer } from './fakeBackupServer';

export interface FakeCloud {
  /** This test's server (a new one for each test). */
  server: FakeBackupServer;
}

/**
 * Call once at the top of a test file: before each test the app gets a backup server
 * URL and a fresh fake server behind `fetch`; after it, running uploads finish.
 */
export function setUpFakeCloudBackup(): FakeCloud {
  const cloud: FakeCloud = { server: new FakeBackupServer() };
  beforeEach(() => {
    cloud.server = new FakeBackupServer();
    vi.stubEnv('VITE_BACKUP_API_URL', TEST_API_URL);
    vi.stubGlobal('fetch', cloud.server.fetch);
  });
  afterEach(async () => {
    await whenBackupIdle();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  return cloud;
}

/** Ten games of the parent's own, "Ava" #12 (the shrink guard ignores sample games). */
export async function seedOwnGames(options: DemoOptions = {}): Promise<void> {
  await importAll(buildRealData(options), 'replace');
}

/** Turns cloud backup on and waits for its first backup; resolves to the code. */
export async function turnOnCloudBackup(): Promise<string> {
  const code = await enableCloudBackup();
  await whenBackupIdle();
  return code;
}

/** The status, once no backup is running. */
export async function settledStatus(): Promise<CloudBackupStatus> {
  await whenBackupIdle();
  return getCloudBackupStatus();
}

/**
 * Another phone backs up `file` with the same code: its backup becomes the newest.
 * (A real encrypted snapshot, so it can be restored.)
 */
export async function backUpFromAnotherPhone(
  server: FakeBackupServer,
  code: string,
  file: ExportFile,
): Promise<void> {
  const keys = await deriveBackupKeys(parseBackupCode(code));
  const api = createBackupApi({ baseUrl: TEST_API_URL, fetch: server.fetch });
  const uploaded = await api.upload(keys, await encryptSnapshot(file, keys));
  if (!uploaded.ok) throw new Error(`The other phone's backup failed: ${uploaded.error.kind}`);
}

/** Backed up, then "Erase all data": paused, so the empty phone can't replace the backup. */
export async function pauseForMissingGames(): Promise<string> {
  await seedOwnGames();
  const code = await turnOnCloudBackup();
  await clearAllData();
  await backUpNow();
  return code;
}

/** Backed up, then another phone backs up with the code: paused, so it isn't replaced. */
export async function pauseForAnotherPhone(
  server: FakeBackupServer,
  otherPhonesData: ExportFile = buildRealData(),
): Promise<string> {
  await seedOwnGames();
  const code = await turnOnCloudBackup();
  await backUpFromAnotherPhone(server, code, otherPhonesData);
  await backUpNow();
  return code;
}

/** Backed up, then the cloud copy turns out deleted mid-upload (409): stopped for the parent. */
export async function stopForDeletedCloudCopy(server: FakeBackupServer): Promise<string> {
  await seedOwnGames();
  const code = await turnOnCloudBackup();
  server.failNext({ status: 409, error: 'account_deleted', method: 'PUT' });
  await backUpNow();
  return code;
}
