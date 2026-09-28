import { expect, test } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, expectRoute, screenHeading, tabBar } from './support/app';
import { DEMO_LIVE_GAME_ID, seedDemoData } from './support/data';

test('loads the Games screen', async ({ page }) => {
  await page.goto('./');

  await expect(page).toHaveTitle('Hoop Stats');
  await expect(screenHeading(page, 'Games')).toBeVisible();
  await expect(tabBar(page).getByRole('link', { name: 'Games' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('tab bar switches between Games, Stats and Settings', async ({ page }) => {
  await page.goto('./');

  for (const [name, path] of [
    ['Stats', paths.stats],
    ['Settings', paths.settings],
    ['Games', paths.home],
  ] as const) {
    const tab = tabBar(page).getByRole('link', { name });
    await tab.tap();
    await expectRoute(page, path);
    await expect(screenHeading(page, name)).toBeVisible();
    await expect(tab).toHaveAttribute('aria-current', 'page');
  }
});

test('full-screen routes hide the tab bar and lead back', async ({ page }) => {
  await page.goto('./');

  await page.getByRole('link', { name: 'New game' }).tap();
  await expectRoute(page, paths.newGame);
  await expect(screenHeading(page, 'New game')).toBeVisible();
  await expect(tabBar(page)).toHaveCount(0);

  await page.getByRole('link', { name: 'Games' }).tap();
  await expect(screenHeading(page, 'Games')).toBeVisible();
  await expect(tabBar(page)).toBeVisible();
});

test('the live game screen has no tab bar', async ({ page }) => {
  await page.goto('./');
  await seedDemoData(page, { liveGame: true });
  await page.goto(appUrl(paths.trackGame(DEMO_LIVE_GAME_ID)));

  await expect(screenHeading(page, 'vs Westfield')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Record a stat' })).toBeVisible();
  await expect(tabBar(page)).toHaveCount(0);
});

test('unknown routes land on Games', async ({ page }) => {
  await page.goto(appUrl('/no/such/page'));

  await expect(screenHeading(page, 'Games')).toBeVisible();
  await expectRoute(page, paths.home);
});

test('serves an installable web app manifest and icons', async ({ page, request }) => {
  await page.goto('./');

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifestUrl = new URL(manifestHref ?? '', page.url());
  const manifest = (await (await request.get(manifestUrl.href)).json()) as {
    icons: { src: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Hoop Stats',
    short_name: 'Hoop Stats',
    display: 'standalone',
    start_url: './',
    scope: './',
  });
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);

  const appleIconHref = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  const iconUrls = [
    ...manifest.icons.map((icon) => new URL(icon.src, manifestUrl).href),
    new URL(appleIconHref ?? '', page.url()).href,
  ];
  for (const url of iconUrls) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(200);
    expect(response.headers()['content-type'], url).toBe('image/png');
  }
});
