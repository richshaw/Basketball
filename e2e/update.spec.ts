import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { screenHeading } from './support/app';
import { DEMO_LIVE_GAME_ID, exportAll, seedDemoData } from './support/data';
import { failNextSaves, tapStats } from './support/tracking';
import { startVersionedServer, type VersionedServer } from './support/versionedServer';

let server: VersionedServer;

test.beforeEach(async () => {
  server = await startVersionedServer();
});

test.afterEach(async () => {
  await server.close();
});

const runningBuild = (page: Page) => page.locator('meta[name="hoop-stats-build"]');
const updateBanner = (page: Page) => page.getByRole('complementary', { name: 'App update' });

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** What the hourly check (and every launch) does. */
async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

for (const visit of ['first visit', 'return visit'] as const) {
  test(`tapping Update reloads into the new version (${visit})`, async ({ page }) => {
    await page.goto(server.url);
    await waitForServiceWorkerControl(page);
    if (visit === 'return visit') {
      // The service worker controls the page from the start this time.
      await page.reload();
      await waitForServiceWorkerControl(page);
    }
    await expect(runningBuild(page)).toHaveAttribute('content', 'a');

    server.deploy('b');
    await checkForUpdate(page);
    const update = updateBanner(page).getByRole('button', { name: 'Update' });
    await expect(update).toBeVisible({ timeout: 15_000 });
    await update.tap();

    await expect(runningBuild(page)).toHaveAttribute('content', 'b', { timeout: 15_000 });
    await expect(screenHeading(page, 'Games')).toBeVisible();
    await expect(updateBanner(page)).toHaveCount(0);
  });
}

test('updating never reloads a live game open in another window', async ({ context, page }) => {
  await page.goto(server.url);
  await waitForServiceWorkerControl(page);
  await seedDemoData(page, { liveGame: true });

  const game = await context.newPage();
  await game.goto(`${server.url}#${paths.trackGame(DEMO_LIVE_GAME_ID)}`);
  // The real live game screen, with the demo game (Q3) loaded.
  await expect(screenHeading(game, 'vs Westfield')).toBeVisible();
  await expect(game.getByRole('button', { name: 'Period Q3' })).toBeVisible();
  // Lost if the window reloads.
  await game.evaluate(() => {
    document.documentElement.dataset.sameDocument = 'yes';
  });

  server.deploy('b');
  await checkForUpdate(page);
  await updateBanner(page).getByRole('button', { name: 'Update' }).tap();
  await expect(runningBuild(page)).toHaveAttribute('content', 'b', { timeout: 15_000 });

  // The live game kept going: same document, old version, no prompt, and it still
  // records stats.
  await expect(game.locator('html')).toHaveAttribute('data-same-document', 'yes');
  await expect(runningBuild(game)).toHaveAttribute('content', 'a');
  await expect(screenHeading(game, 'vs Westfield')).toBeVisible();
  await expect(updateBanner(game)).toHaveCount(0);
  await game
    .getByRole('group', { name: 'Record a stat' })
    .getByRole('button', { name: 'Steal' })
    .tap();
  await expect(game.getByRole('status', { name: 'Last action' })).toContainText('Steal · Q3');
  await expect(game.locator('html')).toHaveAttribute('data-same-document', 'yes');

  // After the game, the tab screens offer the update, which is now just a reload.
  await game.getByRole('link', { name: 'Games', exact: true }).tap();
  await updateBanner(game).getByRole('button', { name: 'Update' }).tap();
  await expect(runningBuild(game)).toHaveAttribute('content', 'b', { timeout: 15_000 });
});

test('the update waits while a reload would lose a tap, and is offered once it would not', async ({
  page,
}) => {
  await page.goto(server.url);
  await waitForServiceWorkerControl(page);
  await page.goto(`${server.url}#${paths.newGame}`);
  await page.getByLabel('Opponent').fill('Westfield');
  await page.getByRole('button', { name: 'Start game' }).tap();
  await expect(screenHeading(page, 'vs Westfield')).toBeVisible();

  // The phone's storage is full and saves fail: a Steal lives only in memory.
  await page.evaluate(() => {
    const state = window as unknown as { storageFull?: boolean };
    state.storageFull = true;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by call() below
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (state.storageFull && key.startsWith('hoop-stats.pending')) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      setItem.call(this, key, value);
    };
  });
  await failNextSaves(page, 1000);
  await tapStats(page, ['Steal']);
  await expect(page.getByRole('alert')).toContainText("It's not kept on this phone.");

  // On to Games, where a new version arrives: updating now would lose the Steal.
  await page.getByRole('link', { name: 'Games', exact: true }).tap();
  await expect(screenHeading(page, 'Games')).toBeVisible();
  server.deploy('b');
  await checkForUpdate(page);
  await expect
    .poll(
      () =>
        page.evaluate(async () =>
          Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
  // The banner says why no update is offered yet, and the new version stays waiting.
  await expect(updateBanner(page)).toContainText('Update once your taps are saved');
  await expect(updateBanner(page).getByRole('button', { name: 'Update' })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(async () =>
      Boolean((await navigator.serviceWorker.getRegistration())?.waiting),
    ),
  ).toBe(true);

  // Saving works again, and the app-wide retry saves the Steal as the app comes back
  // into view: now the update is offered, and loses nothing.
  await failNextSaves(page, 0);
  await page.evaluate(() => {
    (window as unknown as { storageFull?: boolean }).storageFull = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const update = updateBanner(page).getByRole('button', { name: 'Update' });
  await expect(update).toBeVisible({ timeout: 15_000 });
  await update.tap();
  await expect(runningBuild(page)).toHaveAttribute('content', 'b', { timeout: 15_000 });
  const data = await exportAll(page);
  expect(data.events.map((event) => event.type)).toEqual(['stl']);
});

test('toasts rise above the update banner while it shows', async ({ page }) => {
  await page.goto(server.url);
  await waitForServiceWorkerControl(page);
  server.deploy('b');
  await checkForUpdate(page);
  const banner = updateBanner(page);
  await expect(banner.getByRole('button', { name: 'Update' })).toBeVisible({ timeout: 15_000 });

  // Where a toast's bottom edge would sit: its strip is there, empty, until one shows.
  const toastBottom = await page
    .getByRole('status', { name: 'Notifications' })
    .evaluate((strip) => strip.getBoundingClientRect().bottom);
  const bannerTop = (await banner.boundingBox())?.y ?? 0;
  expect(toastBottom).toBeLessThanOrEqual(bannerTop);
});
