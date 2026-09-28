import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, IPHONE_SAFARI_UA, screenHeading, tabBar } from './support/app';
import { clearAllData, demoGameId, exportAll, seedDemoData } from './support/data';

const BACKUP_FIXTURE = fileURLToPath(new URL('./fixtures/settings-backup.json', import.meta.url));

const notifications = (page: Page) => page.getByRole('status', { name: 'Notifications' });

async function openSettings(page: Page) {
  await page.goto(appUrl(paths.settings));
  await expect(screenHeading(page, 'Settings')).toBeVisible();
}

/** Taps "Restore from a backup file" and picks `file` in the file chooser. */
async function restoreFrom(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore from a backup file' }).tap();
  await (await chooser).setFiles(file);
}

test('saves a backup file that restores every game', async ({ page }) => {
  await page.goto('./');
  await seedDemoData(page);
  const before = await exportAll(page);
  await openSettings(page);

  // Chromium here has no file share sheet, so the backup downloads.
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /Save a backup file/ }).tap();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^hoop-stats-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await download.path();
  const backup = JSON.parse(await readFile(file, 'utf8')) as typeof before & {
    app: string;
    schemaVersion: number;
  };
  expect(backup).toMatchObject({ app: 'hoop-stats', schemaVersion: 1 });
  expect(backup.players).toEqual([expect.objectContaining({ name: 'Ava', jerseyNumber: '12' })]);
  expect(backup.games).toHaveLength(10);
  expect({ ...backup, exportedAt: '' }).toMatchObject({ ...before, exportedAt: '' });
  await expect(notifications(page)).toContainText('Backup file downloaded');
  await expect(page.getByRole('button', { name: /Save a backup file/ })).toContainText(
    'Last saved:',
  );

  // It's a real backup: restoring it on an empty phone brings everything back.
  await clearAllData(page);
  await restoreFrom(page, file);
  const sheet = page.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(sheet).toContainText('10 games · Ava #12');
  await sheet.getByRole('button', { name: 'Restore backup' }).tap();
  await expect(notifications(page)).toContainText('Restored 10 games');
  const after = await exportAll(page);
  expect({ ...after, exportedAt: '' }).toEqual({ ...before, exportedAt: '' });
});

test('restores games from a backup file', async ({ page }) => {
  await page.goto('./');
  await clearAllData(page);
  await openSettings(page);

  await restoreFrom(page, BACKUP_FIXTURE);
  const sheet = page.getByRole('dialog', { name: 'Restore this backup?' });
  await expect(sheet).toContainText('2 games · Maya #7');
  await sheet.getByRole('button', { name: 'Restore backup' }).tap();

  await expect(notifications(page)).toContainText('Restored 2 games');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('list', { name: 'Player' })).toContainText('Maya');
  const restored = await exportAll(page);
  expect(restored.games.map((game) => game.opponent)).toEqual(['Hillcrest', 'Brookside']);
  expect(restored.events).toHaveLength(19);
});

test('adds a backup to the games already on the phone', async ({ page }) => {
  await page.goto('./');
  await seedDemoData(page);
  await openSettings(page);

  await restoreFrom(page, BACKUP_FIXTURE);
  await page
    .getByRole('dialog', { name: 'Restore this backup?' })
    .getByRole('button', { name: /Add to what's on this phone/ })
    .tap();

  await expect(notifications(page)).toContainText('Restored 2 games');
  const merged = await exportAll(page);
  expect(merged.games).toHaveLength(12);
  expect(merged.games.map((game) => game.id)).toContain(demoGameId(10));
});

test('explains a file that is not a backup', async ({ page }) => {
  await page.goto('./');
  await openSettings(page);

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore from a backup file' }).tap();
  await (
    await chooser
  ).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('[1, 2]') });

  const sheet = page.getByRole('dialog', { name: "Can't restore this file" });
  await expect(sheet).toContainText("This file isn't a Hoop Stats backup.");
  await sheet.getByRole('button', { name: 'OK' }).tap();
  await expect(sheet).toBeHidden();
});

test('erase all data empties the Games list', async ({ page }) => {
  await page.goto('./');
  await seedDemoData(page);
  await openSettings(page);
  await expect(page.getByRole('button', { name: /Try it with sample data/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Erase all data' }).tap();
  const confirm = page.getByRole('alertdialog', { name: 'Erase all data?' });
  await expect(confirm).toContainText('All 10 games and their stats');
  await confirm.getByRole('button', { name: 'Erase all data' }).tap();

  await expect(notifications(page)).toContainText('All data erased');
  expect(await exportAll(page)).toMatchObject({ players: [], games: [], events: [] });
  // An empty phone offers the sample season again.
  await expect(page.getByRole('button', { name: /Try it with sample data/ })).toBeVisible();

  await tabBar(page).getByRole('link', { name: 'Games' }).tap();
  await expect(screenHeading(page, 'Games')).toBeVisible();
  // "Eastlake" is the newest demo game's opponent.
  await expect(page.getByText('Eastlake')).toHaveCount(0);
});

test('keeps settings across a relaunch', async ({ page }) => {
  await page.goto('./');
  await openSettings(page);

  await page.getByRole('switch', { name: 'Shot chart' }).tap();
  await page.getByRole('radio', { name: 'Halves' }).tap();
  // Both controls follow the stored settings, so these confirm the writes landed
  // before the relaunch.
  await expect(page.getByRole('switch', { name: 'Shot chart' })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Halves' })).toBeChecked();

  await page.reload();
  await expect(screenHeading(page, 'Settings')).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Shot chart' })).not.toBeChecked();
  await expect(page.getByRole('radio', { name: 'Halves' })).toBeChecked();
});

test('no install banner outside iPhone Safari', async ({ page }) => {
  await page.goto('./');
  await expect(screenHeading(page, 'Games')).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Add to Home Screen' })).toHaveCount(0);
});

test.describe('in iPhone Safari', () => {
  test.use({ userAgent: IPHONE_SAFARI_UA });

  test('suggests adding the app to the Home Screen until dismissed', async ({ page }) => {
    await page.goto('./');
    const banner = page.getByRole('complementary', { name: 'Add to Home Screen' });
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'How' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Add to Home Screen' });
    await expect(sheet).toContainText('Tap the Share button');
    await sheet.getByRole('button', { name: 'Close' }).tap();
    await expect(sheet).toBeHidden();

    // Never on the live game screen.
    await page.goto(appUrl(paths.trackGame('demo')));
    await expect(screenHeading(page, 'Live game')).toBeVisible();
    await expect(banner).toHaveCount(0);

    await page.goto(appUrl(paths.home));
    await banner.getByRole('button', { name: 'Dismiss' }).tap();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(screenHeading(page, 'Games')).toBeVisible();
    await expect(banner).toHaveCount(0);
  });
});
