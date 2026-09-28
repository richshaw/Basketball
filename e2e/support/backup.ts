import type { Page } from '@playwright/test';
import { FakeBackupServer } from '../../src/test/fakeBackupServer';

/**
 * The backup server URL the e2e build uses (playwright.config.ts sets it as
 * VITE_BACKUP_API_URL). Nothing answers there unless a test routes it.
 */
export const E2E_BACKUP_API_URL = 'https://backup.hoop-stats.test';

/** Answers the backup server's URL, in this page, from an in-memory copy of the server. */
export async function routeFakeBackupServer(page: Page): Promise<FakeBackupServer> {
  const server = new FakeBackupServer({ allowedOrigins: ['*'] });
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

export async function getBackupStatus(page: Page): Promise<BackupStatus> {
  return (await backup(page)).evaluate(() =>
    (window as unknown as BackupWindow).hoopStats.backup.getCloudBackupStatus(),
  );
}
