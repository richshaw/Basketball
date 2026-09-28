import { expect, test } from '@playwright/test';
import { paths } from '../src/routes';
import {
  emulateIPhoneSafeArea,
  expectRoute,
  IPHONE_VIEWPORT,
  screenHeading,
  tabBar,
} from './support/app';
import { demoGameId, exportAll, seedDemoData } from './support/data';

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
  await expect(page.getByText('Fall 2026 · 10 games')).toBeVisible();
  await expect(page.getByText('7–3', { exact: true })).toBeVisible();
  const pointsTile = page
    .getByLabel('Averages per game')
    .locator('div')
    .filter({ hasText: 'Points per game' });
  await expect(pointsTile.getByRole('definition').first()).toHaveText(
    (points / finalGames.size).toFixed(1),
  );
  await expect(page.getByText(/The game vs Westfield is still in progress/)).toBeVisible();
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

test('with no finished games, the Stats tab leads to a new game', async ({ page }) => {
  await tabBar(page).getByRole('link', { name: 'Stats' }).tap();
  await expect(page.getByRole('heading', { name: 'No stats yet' })).toBeVisible();

  await page.getByRole('link', { name: 'Start a game' }).tap();
  await expectRoute(page, paths.newGame);
});
