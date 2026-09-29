import type { Page } from '@playwright/test';
import { FakeBackupServer } from '../../src/test/fakeBackupServer';

/**
 * The backup server URL the e2e build uses (playwright.config.ts sets it as
 * VITE_BACKUP_API_URL). Nothing answers there unless a test routes it.
 */
export const E2E_BACKUP_API_URL = 'https://backup.hoop-stats.test';

/**
 * Answers the backup server's URL, in this page, from an in-memory copy of the server.
 * Pass the `server` another page routes to for a second phone on the same server.
 */
export async function routeFakeBackupServer(
  page: Page,
  server = new FakeBackupServer({ allowedOrigins: ['*'] }),
): Promise<FakeBackupServer> {
  await page.route(`${E2E_BACKUP_API_URL}/**`, async (route) => {
    const request = route.request();
    const response = server.handle({
      method: request.method(),
      url: request.url(),
      headers: await request.allHeaders(),
      body: request.postDataBuffer(),
    });
    await route.fulfill({
      status: response.status,
      headers: response.headers,
      body: response.body ? Buffer.from(response.body) : '',
    });
  });
  return server;
}

/** The parts of the cloud backup's status that tests look at (see src/data/backup/status.ts). */
export interface BackupStatus {
  enabled: boolean;
  state: string;
  pendingChanges: boolean;
  shrink?: { backedUpGames: number; missingGames: number };
  otherDevice?: { backedUpAt?: number };
  lastError?: { kind: string; message: string };
}

/**
 * Another phone backs up with the same code as the one phone on `server`: a new newest
 * backup (not a real snapshot: it can't be restored), straight on the server.
 */
export function backUpFromAnotherPhone(server: FakeBackupServer): void {
  const [entry, ...others] = server.accounts.entries();
  if (!entry || others.length > 0) throw new Error('Expected exactly one backup on the server');
  const [accountId, account] = entry;
  const response = server.handle({
    method: 'PUT',
    url: `${E2E_BACKUP_API_URL}/v1/backups/${accountId}`,
    headers: { authorization: `Bearer ${account.token}`, 'content-length': '64' },
    body: new Uint8Array(64).fill(7),
  });
  if (response.status !== 201)
    throw new Error(`The other phone's backup failed: ${response.status}`);
}

type Result = { ok: true; value?: Record<string, unknown> } | { ok: false; error: unknown };

/** window.hoopStats.backup, the cloud backup's API (src/data/backup/cloudBackup.ts). */
interface BackupWindow {
  hoopStats: {
    backup: {
      enableCloudBackup(): Promise<string>;
      backUpNow(options?: { force?: boolean }): Promise<Result>;
      fetchCloudBackup(code: string): Promise<Result>;
      getCloudBackupStatus(): Promise<BackupStatus>;
      getBackupCode(): Promise<string | undefined>;
      disableCloudBackup(options?: { deleteCloudCopy?: boolean }): Promise<Result>;
      setBackupTimingsForTests(timings: Record<string, number>): void;
    };
  };
}

async function backup(page: Page) {
  await page.waitForFunction(() => 'hoopStats' in window);
  return page;
}

/** Shortens the scheduler's waits (ms), e.g. `{ debounceMs: 300 }`. */
export async function setBackupTimings(page: Page, timings: Record<string, number>) {
  await (
    await backup(page)
  ).evaluate(
    (value) => (window as unknown as BackupWindow).hoopStats.backup.setBackupTimingsForTests(value),
    timings,
  );
}

/** Turns cloud backup on; resolves to the new backup code. */
export async function enableCloudBackup(page: Page): Promise<string> {
  return (await backup(page)).evaluate(() =>
    (window as unknown as BackupWindow).hoopStats.backup.enableCloudBackup(),
  );
}

export async function backUpNow(page: Page, options: { force?: boolean } = {}): Promise<Result> {
  return (await backup(page)).evaluate(
    (value) => (window as unknown as BackupWindow).hoopStats.backup.backUpNow(value),
    options,
  );
}

/** Downloads and decrypts the backup for `code`, in the page. */
export async function fetchCloudBackup(page: Page, code: string): Promise<Result> {
  return (await backup(page)).evaluate(
    (value) => (window as unknown as BackupWindow).hoopStats.backup.fetchCloudBackup(value),
    code,
  );
}

/** Turns cloud backup off (keeping the code and the online backup, unless told to delete it). */
export async function disableCloudBackup(
  page: Page,
  options: { deleteCloudCopy?: boolean } = {},
): Promise<Result> {
  return (await backup(page)).evaluate(
    (value) => (window as unknown as BackupWindow).hoopStats.backup.disableCloudBackup(value),
    options,
  );
}

/** This phone's backup code (on, or kept after turning off), if it has one. */
export async function getBackupCode(page: Page): Promise<string | undefined> {
  return (await backup(page)).evaluate(() =>
    (window as unknown as BackupWindow).hoopStats.backup.getBackupCode(),
  );
}

export async function getBackupStatus(page: Page): Promise<BackupStatus> {
  return (await backup(page)).evaluate(() =>
    (window as unknown as BackupWindow).hoopStats.backup.getCloudBackupStatus(),
  );
}
