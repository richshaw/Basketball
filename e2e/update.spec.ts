import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { screenHeading } from './support/app';
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

  const game = await context.newPage();
  await game.goto(`${server.url}#${paths.trackGame('live')}`);
  await expect(screenHeading(game, 'Live game')).toBeVisible();
  // Lost if the window reloads.
  await game.evaluate(() => {
    document.documentElement.dataset.sameDocument = 'yes';
  });

  server.deploy('b');
  await checkForUpdate(page);
  await updateBanner(page).getByRole('button', { name: 'Update' }).tap();
  await expect(runningBuild(page)).toHaveAttribute('content', 'b', { timeout: 15_000 });

  // The live game kept going: same document, old version, no prompt.
  await expect(game.locator('html')).toHaveAttribute('data-same-document', 'yes');
  await expect(runningBuild(game)).toHaveAttribute('content', 'a');
  await expect(screenHeading(game, 'Live game')).toBeVisible();
  await expect(updateBanner(game)).toHaveCount(0);

  // After the game, the tab screens offer the update, which is now just a reload.
  await game.getByRole('link', { name: 'Report' }).tap();
  await game.getByRole('link', { name: 'Games', exact: true }).tap();
  await updateBanner(game).getByRole('button', { name: 'Update' }).tap();
  await expect(runningBuild(game)).toHaveAttribute('content', 'b', { timeout: 15_000 });
});
