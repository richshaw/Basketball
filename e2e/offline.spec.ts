import { expect, test } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, screenHeading, tabBar } from './support/app';
import { DEMO_LIVE_GAME_ID, exportAll, seedDemoData } from './support/data';

test('keeps working with no signal after the first visit', async ({ page, context }) => {
  await page.goto('./');
  await expect(screenHeading(page, 'Games')).toBeVisible();
  await seedDemoData(page, { liveGame: true });

  // The service worker precaches the whole app while installing, then claims this page.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);

  await page.reload();
  await expect(screenHeading(page, 'Games')).toBeVisible();

  await tabBar(page).getByRole('link', { name: 'Stats' }).tap();
  await expect(screenHeading(page, 'Stats')).toBeVisible();

  // A cold start straight into the live game is served from the cache too, and taps
  // are saved with no signal.
  await page.goto(appUrl(paths.trackGame(DEMO_LIVE_GAME_ID)));
  await page.reload();
  await expect(screenHeading(page, 'vs Westfield')).toBeVisible();
  await page
    .getByRole('group', { name: 'Record a stat' })
    .getByRole('button', { name: 'Block' })
    .tap();
  await expect(page.getByRole('status', { name: 'Last action' })).toContainText('Block · Q3');
  const events = (await exportAll(page)).events.filter((e) => e.gameId === DEMO_LIVE_GAME_ID);
  expect(events.at(-1)).toMatchObject({ type: 'blk', period: 3 });
});
