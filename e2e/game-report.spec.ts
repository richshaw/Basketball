import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import {
  appUrl,
  emulateIPhoneSafeArea,
  expectRoute,
  IPHONE_VIEWPORT,
  screenHeading,
} from './support/app';
import {
  DEMO_LIVE_GAME_ID,
  demoGameId,
  exportAll,
  seedDemoData,
  type ExportedData,
} from './support/data';

/** Fixed, so the demo game dates are known: game 10 is four days earlier, Thu, Sep 24. */
const DEMO_TODAY = '2026-09-28';

const notifications = (page: Page) => page.getByRole('status', { name: 'Notifications' });

/** The big number of the tile named `label` (its full label) in the tile grid named `grid`. */
function tileValue(page: Page, grid: string, label: string) {
  return page
    .getByLabel(grid, { exact: true })
    .locator('div')
    .filter({ has: page.getByText(label, { exact: true }) })
    .getByRole('definition')
    .first();
}

/** Her points and rebounds in one game, counted straight from the stored stats. */
function countStats(data: ExportedData, gameId: string) {
  const points: Record<string, number> = { fg2_made: 2, fg3_made: 3, ft_made: 1 };
  const events = data.events.filter((event) => event.gameId === gameId);
  return {
    pts: events.reduce((sum, event) => sum + (points[event.type] ?? 0), 0),
    reb: events.filter((event) => event.type === 'oreb' || event.type === 'dreb').length,
    ast: events.filter((event) => event.type === 'ast').length,
  };
}

test.beforeEach(async ({ page }) => {
  await emulateIPhoneSafeArea(page);
  await page.goto('./');
  await seedDemoData(page, { today: DEMO_TODAY, liveGame: true });
});

test('a game report: the numbers, a score fix, a copied recap, then deleting the game', async ({
  page,
}) => {
  const gameId = demoGameId(10);
  const stats = countStats(await exportAll(page), gameId);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto(appUrl(paths.gameReport(gameId)));
  await expect(screenHeading(page, 'vs Eastlake')).toBeVisible();
  await expect(page.getByText('Thu, Sep 24, 2026 · Fall 2026')).toBeVisible();
  await expect(tileValue(page, 'Game totals', 'Points')).toHaveText(String(stats.pts));
  await expect(tileValue(page, 'Game totals', 'Rebounds')).toHaveText(String(stats.reb));
  await expect(tileValue(page, 'Game totals', 'Assists')).toHaveText(String(stats.ast));
  // The shot chart: her shots on the court, and her shooting by zone.
  const shotChart = page.getByRole('region', { name: 'Shot chart' });
  await expect(shotChart.getByRole('figure', { name: 'Shot chart', exact: true })).toBeVisible();
  await expect(
    shotChart.getByRole('img', { name: /^Shot chart: \d+ shots? on the map/ }),
  ).toBeVisible();
  await expect(shotChart.getByLabel('Shooting by zone')).toBeVisible();
  // Only the by-quarter table scrolls sideways; the page itself never does.
  await expect(page.getByRole('table', { name: 'Stats by quarter' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    IPHONE_VIEWPORT.width,
  );

  // Fix the final score.
  await page.getByRole('button', { name: 'Edit details' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Edit game' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Our score').fill('61');
  await sheet.getByLabel('Their score').fill('40');
  await sheet.getByRole('button', { name: 'Save' }).tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('Won 61–40')).toBeVisible();
  await expect(notifications(page)).toHaveText('Changes saved');

  // Chromium has no share sheet here, so the recap is copied instead.
  await page.getByRole('button', { name: 'Share recap' }).tap();
  await expect(notifications(page)).toHaveText('Copied');
  const recap = await page.evaluate(() => navigator.clipboard.readText());
  const [heading, counts] = recap.split('\n');
  expect(heading).toBe('Ava vs Eastlake — Won 61–40 (Thu, Sep 24)');
  expect(counts).toMatch(new RegExp(`^${stats.pts} PTS · ${stats.reb} REB`));

  // Delete the game: Games replaces the report.
  await page.getByRole('button', { name: 'Delete game' }).tap();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this game?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete game' }).tap();
  await expectRoute(page, paths.home);
  await expect(screenHeading(page, 'Games')).toBeVisible();
  await expect(notifications(page)).toHaveText('Game deleted');
  const after = await exportAll(page);
  expect(after.games.map((game) => game.id)).not.toContain(gameId);
  expect(after.events.filter((event) => event.gameId === gameId)).toEqual([]);
});

test('a play can be deleted from the play-by-play', async ({ page }) => {
  const gameId = demoGameId(10);
  const before = await exportAll(page);
  const stats = countStats(before, gameId);

  await page.goto(appUrl(paths.gameReport(gameId)));
  await expect(tileValue(page, 'Game totals', 'Points')).toHaveText(String(stats.pts));
  // A long game starts with each quarter closed.
  const firstQuarter = page.getByRole('button', { name: /^1st quarter, / });
  await expect(firstQuarter).toHaveAttribute('aria-expanded', 'false');
  await firstQuarter.scrollIntoViewIfNeeded();
  await firstQuarter.tap();
  await expect(firstQuarter).toHaveAttribute('aria-expanded', 'true');

  const plays = page.getByRole('list', { name: '1st quarter plays' }).getByRole('button');
  const names = await plays.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label') ?? ''),
  );
  const index = names.findIndex((name) => name.includes('2PT Made'));
  const neighbor = names[index + 1] ?? names[index - 1] ?? '';
  expect(names[index]).toMatch(/, 2PT Made, \+2 points$/);
  await plays.nth(index).tap();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this stat?' });
  await dialog.getByRole('button', { name: 'Delete stat' }).tap();

  await expect(notifications(page)).toHaveText('Deleted 2PT Made');
  await expect(tileValue(page, 'Game totals', 'Points')).toHaveText(String(stats.pts - 2));
  // Focus moves on to the next play instead of dropping to the page.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toBe(neighbor);
  const after = await exportAll(page);
  expect(after.events).toHaveLength(before.events.length - 1);
});

test('a live game offers to resume tracking', async ({ page }) => {
  await page.goto(appUrl(paths.gameReport(DEMO_LIVE_GAME_ID)));
  await expect(screenHeading(page, 'vs Westfield')).toBeVisible();
  await expect(page.getByText('In progress')).toBeVisible();

  await page.getByRole('link', { name: 'Resume tracking' }).tap();
  await expectRoute(page, paths.trackGame(DEMO_LIVE_GAME_ID));
});

test('a missing game says so and leads back to Games', async ({ page }) => {
  await page.goto(appUrl(paths.gameReport('no-such-game')));
  await expect(page.getByRole('heading', { name: 'Game not found' })).toBeVisible();

  await page.getByRole('link', { name: 'Go to Games' }).tap();
  await expectRoute(page, paths.home);
});
