import { expect, test } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, screenHeading, tabBar } from './support/app';

test('keeps working with no signal after the first visit', async ({ page, context }) => {
  await page.goto('./');
  await expect(screenHeading(page, 'Games')).toBeVisible();

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

  // A cold start straight into a deep link is served from the cache too.
  await page.goto(appUrl(paths.trackGame('offline')));
  await page.reload();
  await expect(screenHeading(page, 'Live game')).toBeVisible();
});
