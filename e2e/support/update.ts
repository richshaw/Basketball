import { expect, type Page } from '@playwright/test';
import { paths } from '../../src/routes';
import { screenHeading } from './app';
import { failNextSaves, tapStats } from './tracking';
import type { VersionedServer } from './versionedServer';

/** The tab screens' app-update banner. */
export const updateBanner = (page: Page) => page.getByRole('complementary', { name: 'App update' });

export async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** What the hourly check (and every launch) does. */
export async function checkForUpdate(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

/**
 * Brings a new version while a reload would lose a tap: a live game's Steal lives only
 * in memory (the phone's storage is full, and saves fail until `failNextSaves(page, 0)`
 * and `storageFull` is false), and Games shows the banner that waits for the taps, with
 * the new version waiting.
 */
export async function bringUpdateBehindATap(page: Page, server: VersionedServer) {
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
  await expect(updateBanner(page)).toContainText('Update once your taps are saved');
}
