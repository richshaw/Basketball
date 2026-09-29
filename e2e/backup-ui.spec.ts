import { expect, test, type Browser, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, expectRoute, screenHeading } from './support/app';
import {
  enableCloudBackup,
  fetchCloudBackup,
  getBackupCode,
  routeFakeBackupServer,
  setBackupTimings,
} from './support/backup';
import { ownGameId, seedOwnGames } from './support/ownGames';

// page.route can't see requests a service worker handles, and the worker isn't under test.
test.use({ serviceWorkers: 'block' });

const notifications = (page: Page) => page.getByRole('status', { name: 'Notifications' });

/** A backup code as the engine writes it. */
const CODE = /^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/;

/** Short scheduler waits, so a change goes up within a second or so. */
async function quickBackups(page: Page) {
  await setBackupTimings(page, {
    debounceMs: 300,
    maxWaitMs: 1000,
    liveGameMaxWaitMs: 1000,
    minIntervalMs: 0,
    liveGameMinIntervalMs: 0,
    gameEndDelayMs: 0,
  });
}

/** Another iPhone: a fresh browser context, so nothing is stored on it (not even a code). */
async function newPhone(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });
  return context.newPage();
}

test('turns on cloud backup, shows the code to save, and backs up a changed stat', async ({
  page,
}) => {
  const server = await routeFakeBackupServer(page);
  await page.goto('./');
  await seedOwnGames(page);
  await quickBackups(page);

  const cloudBackup = page.getByRole('list', { name: 'Cloud backup' });
  await cloudBackup.getByRole('button', { name: 'Turn on cloud backup' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Save your backup code' });
  const shownCode = sheet.getByText(CODE);
  await expect(shownCode).toBeVisible();
  const code = (await shownCode.textContent()) ?? '';
  expect(code).toBe(await getBackupCode(page));
  await sheet.getByRole('button', { name: "I've saved it" }).tap();
  await expect(sheet).toHaveCount(0);

  // It backs up at once, encrypted.
  await expect(cloudBackup).toContainText('Backed up just now');
  expect(server.uploads).toHaveLength(1);
  const first = await fetchCloudBackup(page, code);
  expect(first).toMatchObject({ ok: true, value: { games: 10 } });
  const events = first.ok ? Number(first.value?.events) : 0;

  // A stat deleted from a game's play-by-play goes up on its own.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Games' }).tap();
  await page.getByRole('list', { name: 'Fall 2026' }).getByRole('link').first().tap();
  await expectRoute(page, paths.gameReport(ownGameId(10)));
  const firstQuarter = page.getByRole('button', { name: /^1st quarter, / });
  await firstQuarter.scrollIntoViewIfNeeded();
  await firstQuarter.tap();
  await page.getByRole('list', { name: '1st quarter plays' }).getByRole('button').first().tap();
  await page
    .getByRole('alertdialog', { name: 'Delete this stat?' })
    .getByRole('button', { name: 'Delete stat' })
    .tap();
  await expect(notifications(page)).toContainText('Deleted');

  await expect.poll(() => server.uploads.length).toBe(2);
  expect(await fetchCloudBackup(page, code)).toMatchObject({
    ok: true,
    value: { games: 10, events: events - 1 },
  });
});

test('restores the games on a new phone from the backup code', async ({
  page,
  browser,
  baseURL,
}) => {
  const server = await routeFakeBackupServer(page);
  await page.goto('./');
  await seedOwnGames(page);
  const code = await enableCloudBackup(page);
  await expect.poll(() => server.uploads.length).toBe(1);

  // A new phone, on the same server: the first-run card leads to the restore.
  const phone = await newPhone(browser, baseURL);
  await routeFakeBackupServer(phone, server);
  await phone.goto('./');
  await expect(screenHeading(phone, 'Games')).toBeVisible();
  await phone
    .getByRole('region', { name: 'Who are you tracking?' })
    .getByRole('link', { name: 'Restore from a backup' })
    .tap();
  await expectRoute(phone, paths.restoreBackup('games'));
  await expect(screenHeading(phone, 'Restore from backup')).toBeVisible();

  // Typed the way a parent might copy it off a note: lowercase, spaces for dashes.
  await phone.getByLabel('Backup code').fill(code.toLowerCase().replaceAll('-', ' '));
  await phone.getByRole('button', { name: 'Find backup' }).tap();
  const sheet = phone.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(sheet).toContainText('10 games · Ava #12');
  await sheet.getByRole('button', { name: 'Restore backup' }).tap();

  await expectRoute(phone, paths.home);
  await expect(notifications(phone)).toContainText(
    'Restored 10 games. This phone now backs up with this code.',
  );
  await expect(phone.getByText('Ava · #12')).toBeVisible();
  await expect(phone.getByRole('list', { name: 'Fall 2026' }).getByRole('link')).toHaveCount(10);

  // It carries on backing up with the same code, into the same backup.
  expect(await getBackupCode(phone)).toBe(code);
  await expect.poll(() => server.uploads.length).toBe(2);
  expect(new Set(server.uploads.map((upload) => upload.accountId)).size).toBe(1);
  await phone.goto(appUrl(paths.settings));
  await expect(phone.getByRole('list', { name: 'Cloud backup' })).toContainText(
    'Backed up just now',
  );
  await phone.context().close();
});

test('the whole backup code fits its field on a 375-point iPhone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await routeFakeBackupServer(page);
  await page.goto('./');
  const code = await enableCloudBackup(page);

  await page.goto(appUrl(paths.restoreBackup()));
  const field = page.getByLabel('Backup code');
  // Filled in with this phone's own code, all of it in view.
  await expect(field).toHaveValue(code);
  const { scrollWidth, clientWidth } = await field.evaluate((input: HTMLInputElement) => ({
    scrollWidth: input.scrollWidth,
    clientWidth: input.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
