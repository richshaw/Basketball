import { expect, test } from '@playwright/test';
import { screenHeading } from './support/app';
import {
  backUpNow,
  enableCloudBackup,
  fetchCloudBackup,
  getBackupStatus,
  routeFakeBackupServer,
  setBackupTimings,
} from './support/backup';
import { clearAllData, seedDemoData } from './support/data';

// page.route can't see requests a service worker handles, and the worker isn't under test.
test.use({ serviceWorkers: 'block' });

test('backs up encrypted snapshots in the background, and waits for signal', async ({
  page,
  context,
}) => {
  const server = await routeFakeBackupServer(page);
  await page.goto('./');
  await expect(screenHeading(page, 'Games')).toBeVisible();
  await seedDemoData(page);
  await setBackupTimings(page, {
    debounceMs: 300,
    maxWaitMs: 1000,
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
  for (const plain of ['hoop-stats', 'Ava', 'Lincoln', code]) {
    expect(body.toString('latin1')).not.toContain(plain);
  }
  expect(() => JSON.parse(body.toString('utf8')) as unknown).toThrow();
  // The code brings the data back (downloaded and decrypted in the page).
  expect(await fetchCloudBackup(page, code)).toMatchObject({ ok: true, value: { games: 10 } });

  // A change goes up on its own, after the (shortened) debounce.
  await seedDemoData(page, { liveGame: true });
  await expect.poll(() => server.uploads.length).toBe(2);

  // Without signal nothing goes up, until it's back.
  await context.setOffline(true);
  await seedDemoData(page);
  await expect
    .poll(async () => getBackupStatus(page))
    .toMatchObject({ state: 'waiting-for-signal', pendingChanges: true });
  await page.waitForTimeout(1500);
  expect(server.uploads).toHaveLength(2);
  await context.setOffline(false);
  await expect.poll(() => server.uploads.length).toBe(3);
  await expect.poll(async () => (await getBackupStatus(page)).state).toBe('idle');

  // "Erase all data" can't replace the backup until the parent confirms.
  await clearAllData(page);
  await expect.poll(async () => (await getBackupStatus(page)).state).toBe('paused-shrink');
  expect(server.uploads).toHaveLength(3);
  expect(await backUpNow(page, { force: true })).toMatchObject({ ok: true });
  expect(server.uploads).toHaveLength(4);
});
