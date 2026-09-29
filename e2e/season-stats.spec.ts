import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import {
  appUrl,
  emulateIPhoneSafeArea,
  expectRoute,
  IPHONE_VIEWPORT,
  screenHeading,
  tabBar,
} from './support/app';
import { demoGameId, exportAll, patchGames, seedDemoData, type GamePatch } from './support/data';

/** Points per made shot, to check the screen's math against the stored events. */
const POINTS: Record<string, number> = { fg2_made: 2, fg3_made: 3, ft_made: 1 };

test.beforeEach(async ({ page }) => {
  await emulateIPhoneSafeArea(page);
  await page.goto('./');
});

test('shows the season, switches the chart and opens a game from the log', async ({ page }) => {
  await seedDemoData(page, { liveGame: true });
  const data = await exportAll(page);
  const finalGames = new Set(
    data.games.filter((game) => game.status === 'final').map((game) => game.id),
  );
  const points = data.events
    .filter((event) => finalGames.has(event.gameId))
    .reduce((sum, event) => sum + (POINTS[event.type] ?? 0), 0);

  await tabBar(page).getByRole('link', { name: 'Stats' }).tap();
  await expectRoute(page, paths.stats);
  await expect(screenHeading(page, 'Stats')).toBeVisible();

  // The season's numbers: only the ten final games count, not the one in progress.
  // (The summary's line, a <p>: the shot chart's caption repeats it.)
  await expect(page.getByText('Fall 2026 · 10 games').and(page.locator('p'))).toBeVisible();
  await expect(page.getByText('7–3', { exact: true })).toBeVisible();
  const pointsTile = page
    .getByLabel('Averages per game')
    .locator('div')
    .filter({ hasText: 'Points per game' });
  await expect(pointsTile.getByRole('definition').first()).toHaveText(
    (points / finalGames.size).toFixed(1),
  );
  await expect(page.getByText(/The game against Westfield is still in progress/)).toBeVisible();
  // The season's shot chart, named by the section's heading and its caption.
  await expect(page.getByRole('figure', { name: 'Shot chart Fall 2026 · 10 games' })).toBeVisible();
  await expect(page.getByLabel('Shooting by zone')).toBeVisible();
  // Nothing on the screen makes the page scroll sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    IPHONE_VIEWPORT.width,
  );

  // Switch the chart to rebounds, then read the newest game off it.
  await expect(page.getByRole('group', { name: 'Points by game' })).toBeVisible();
  await page.getByRole('radio', { name: 'Rebounds' }).tap();
  const rebounds = page.getByRole('group', { name: 'Rebounds by game' });
  await expect(rebounds).toBeVisible();
  await expect(page.getByText('rebounds per game', { exact: true })).toBeVisible();
  await expect(rebounds.getByRole('button')).toHaveCount(10);
  await rebounds.getByRole('button').last().tap();
  await expect(rebounds.getByRole('button').last()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /^Game report, vs Eastlake/ })).toBeVisible();

  // A tap anywhere on a game log row (here on its points) opens that game's report.
  const newest = page.getByRole('table', { name: 'Game log' }).getByRole('row').nth(1);
  await expect(newest.getByRole('rowheader')).toContainText('Eastlake');
  await newest.getByRole('cell').nth(1).tap();
  await expectRoute(page, paths.gameReport(demoGameId(10)));
});

/** Moves all ten demo games into `season`, then opens the Stats screen afresh. */
async function showSeason(page: Page, season: string) {
  await patchGames(
    page,
    Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [demoGameId(index + 1), { season }]),
    ),
  );
  await page.goto('about:blank');
  await page.goto(appUrl(paths.stats));
  await expect(page.getByText(`${season} · 10 games`).first()).toBeVisible();
}

test('a long season name leaves the totals in view, and never widens the page', async ({
  page,
}) => {
  const season = 'Westside Warriors 12U Spring 2026';
  await seedDemoData(page);
  await showSeason(page, season);

  const totals = page.getByRole('table', { name: 'Totals' });
  await totals.scrollIntoViewIfNeeded();
  // The label is capped (it ends in "…"), and the first stats sit beside it on screen.
  const label = await totals.getByRole('rowheader', { name: season }).boundingBox();
  const points = await totals.getByRole('columnheader', { name: 'Points' }).boundingBox();
  expect(label?.width).toBeLessThan(IPHONE_VIEWPORT.width / 2);
  expect((points?.x ?? Infinity) + (points?.width ?? 0)).toBeLessThanOrEqual(IPHONE_VIEWPORT.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    IPHONE_VIEWPORT.width,
  );

  // As long as a name can be (60 characters), with no space to wrap at: it wraps anyway.
  await showSeason(page, 'W'.repeat(60));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    IPHONE_VIEWPORT.width,
  );
});

test("the season picker shows the app's own season names in full, also 375 points wide", async ({
  page,
}) => {
  await seedDemoData(page);
  for (const [newer, older] of [
    ['Fall 2026', 'Summer 2026'],
    ['Winter 2027', 'Spring 2027'],
  ] as const) {
    // The five newest games in the newer season, the others in the older one.
    const seasons: Record<string, GamePatch> = {};
    for (let n = 1; n <= 10; n += 1) seasons[demoGameId(n)] = { season: n > 5 ? newer : older };
    await patchGames(page, seasons);
    for (const width of [390, 375]) {
      await page.setViewportSize({ width, height: IPHONE_VIEWPORT.height });
      await page.goto('about:blank');
      await page.goto(appUrl(paths.stats));
      const radios = page.getByRole('radiogroup', { name: 'Season' }).getByRole('radio');
      await expect(radios).toHaveText(['All', newer, older]);
      const positions = () =>
        radios.evaluateAll((all) =>
          all.map((radio) => Math.round(radio.getBoundingClientRect().x)),
        );
      const before = await positions();
      for (const radio of await radios.all()) {
        // Selected, in bold: the widest a label gets.
        await radio.tap();
        await expect(radio).toBeChecked();
        expect(await radio.evaluate((el) => el.scrollWidth <= el.clientWidth), `${width}`).toBe(
          true,
        );
        expect(await positions()).toEqual(before);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
});

test('with no finished games, the Stats tab leads to a new game', async ({ page }) => {
  await tabBar(page).getByRole('link', { name: 'Stats' }).tap();
  await expect(page.getByRole('heading', { name: 'No stats yet' })).toBeVisible();

  await page.getByRole('link', { name: 'Start a game' }).tap();
  await expectRoute(page, paths.newGame);
});
