import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, screenHeading } from './support/app';
import {
  backUpNow,
  enableCloudBackup,
  fetchCloudBackup,
  getBackupStatus,
  routeFakeBackupServer,
  setBackupTimings,
} from './support/backup';
import { clearAllData, seedDemoData } from './support/data';

/** Two games of the parent's own ("Maya" #7), restored from a backup file in Settings. */
const OWN_GAMES = fileURLToPath(new URL('./fixtures/settings-backup.json', import.meta.url));

// page.route can't see requests a service worker handles, and the worker isn't under test.
test.use({ serviceWorkers: 'block' });

async function restoreOwnGames(page: Page) {
  await page.goto(appUrl(paths.settings));
  await expect(screenHeading(page, 'Settings')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore from a backup file' }).tap();
  await (await chooser).setFiles(OWN_GAMES);
  await page
    .getByRole('dialog', { name: 'Restore this backup?' })
    .getByRole('button', { name: 'Restore backup' })
    .tap();
  await expect(page.getByRole('list', { name: 'Player' })).toContainText('Maya');
}

test('backs up encrypted snapshots in the background, and waits for signal', async ({
  page,
  context,
}) => {
  const server = await routeFakeBackupServer(page);
  await restoreOwnGames(page);
  await setBackupTimings(page, {
    debounceMs: 300,
    maxWaitMs: 1000,
    liveGameMaxWaitMs: 1000,
    minIntervalMs: 0,
    liveGameMinIntervalMs: 0,
    gameEndDelayMs: 0,
  });

  // Turning backup on uploads right away, encrypted.
  const code = await enableCloudBackup(page);
  expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/);
  await expect.poll(() => server.uploads.length).toBe(1);
  const body = Buffer.from(server.uploads[0]?.bytes ?? []);
  expect(body.subarray(0, 4).toString('latin1')).toBe('HSB1');
  for (const plain of ['hoop-stats', 'Maya', 'Hillcrest', code]) {
    expect(body.toString('latin1')).not.toContain(plain);
  }
  expect(() => JSON.parse(body.toString('utf8')) as unknown).toThrow();
  // The code brings the data back (downloaded and decrypted in the page).
  expect(await fetchCloudBackup(page, code)).toMatchObject({ ok: true, value: { games: 2 } });

  // A change goes up on its own, after the (shortened) debounce.
  const shotChart = page.getByRole('switch', { name: 'Shot chart' });
  await shotChart.tap();
  await expect.poll(() => server.uploads.length).toBe(2);

  // Without signal nothing goes up, until it's back.
  await context.setOffline(true);
  await shotChart.tap();
  await expect
    .poll(async () => getBackupStatus(page))
    .toMatchObject({ state: 'waiting-for-signal', pendingChanges: true });
  await page.waitForTimeout(1500);
  expect(server.uploads).toHaveLength(2);
  await context.setOffline(false);
  await expect.poll(() => server.uploads.length).toBe(3);
  await expect.poll(async () => (await getBackupStatus(page)).state).toBe('idle');

  // "Erase all data", even followed by sample data, can't replace the backup until the
  // parent confirms.
  await clearAllData(page);
  await expect.poll(async () => (await getBackupStatus(page)).state).toBe('paused-shrink');
  await seedDemoData(page);
  await page.waitForTimeout(1000);
  expect(await getBackupStatus(page)).toMatchObject({
    state: 'paused-shrink',
    shrink: { backedUpGames: 2, missingGames: 2 },
  });
  expect(server.uploads).toHaveLength(3);
  expect(await backUpNow(page, { force: true })).toMatchObject({ ok: true });
  expect(server.uploads).toHaveLength(4);
});
