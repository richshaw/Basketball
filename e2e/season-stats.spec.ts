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

// The chart's readout shows a game's result in full, and every stat to chart is named
// whole, down to 320 points wide (an iPhone SE with Display Zoom).
for (const width of [375, 320]) {
  test(`the chart reads a game's result in full at ${width} points wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await seedDemoData(page);
    await page.goto(appUrl(paths.stats));
    const chart = page.getByRole('group', { name: 'Points by game' });
    // The longest matchup of the season: "vs Central Catholic · L 36–43".
    await chart.getByRole('button').nth(2).tap();
    await expect(
      page.getByRole('link', { name: /^Game report, vs Central Catholic/ }),
    ).toBeVisible();
    // The readout's line with the matchup and the result, in full: nothing on it is cut.
    const meta = page.locator('p').filter({ hasText: /^vs Central Catholic\s· L \d+–\d+$/ });
    await expect(meta).toBeVisible();

    const cut = (locator: typeof meta) =>
      locator.evaluateAll((elements) =>
        elements
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.textContent),
      );
    expect(await cut(meta.locator('xpath=self::*|descendant::*'))).toEqual([]);

    // "Rebounds" is whole too, picked (in bold) or not.
    const radios = page.getByRole('radiogroup', { name: 'Stat to chart' }).getByRole('radio');
    expect(await cut(radios)).toEqual([]);
    await page.getByRole('radio', { name: 'Rebounds' }).tap();
    await expect(page.getByRole('radio', { name: 'Rebounds' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await cut(radios)).toEqual([]);
    expect(await cut(meta.locator('xpath=self::*|descendant::*'))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

// Page zoom (Safari's 150% on an iPhone SE leaves 250 points): the stats' names no longer
// fit, so the chart offers them by their short labels, whole, rather than cut short.
test('with page zoom, the stats to chart are offered by their short labels, whole', async ({
  page,
}) => {
  await page.setViewportSize({ width: 250, height: 700 });
  await seedDemoData(page);
  await page.goto(appUrl(paths.stats));
  const radios = page.getByRole('radiogroup', { name: 'Stat to chart' }).getByRole('radio');
  await expect(radios).toHaveText(['PTS', 'REB', 'AST']);
  expect(
    await radios.evaluateAll((all) => all.filter((radio) => radio.scrollWidth > radio.clientWidth)),
  ).toEqual([]);
  // Named in full to screen readers.
  await page.getByRole('radio', { name: 'Rebounds' }).tap();
  await expect(page.getByRole('group', { name: 'Rebounds by game' })).toBeVisible();
  await expect(radios).toHaveText(['PTS', 'REB', 'AST']);
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

// The app's own season names, at 390 and 375 points and at 320 (an iPhone SE or mini
// with Display Zoom), and the widths where they need a sheet instead of segments. (At
// 320 the segments are tighter, so "Winter 2027" and "Spring 2027" fit.)
const SEASON_PAIRS = [
  { newer: 'Fall 2026', older: 'Summer 2026', sheetAt: [] as number[] },
  { newer: 'Winter 2027', older: 'Spring 2027', sheetAt: [] },
  { newer: 'Summer 2027', older: 'Summer 2026', sheetAt: [320] },
];

test("the season picker shows the app's own season names in full, never widening the page", async ({
  page,
}) => {
  await seedDemoData(page);
  for (const { newer, older, sheetAt } of SEASON_PAIRS) {
    // The five newest games in the newer season, the others in the older one.
    const seasons: Record<string, GamePatch> = {};
    for (let n = 1; n <= 10; n += 1) seasons[demoGameId(n)] = { season: n > 5 ? newer : older };
    await patchGames(page, seasons);
    for (const width of [390, 375, 320]) {
      const at = `${newer} / ${older} at ${width}`;
      await page.setViewportSize({ width, height: IPHONE_VIEWPORT.height });
      await page.goto('about:blank');
      await page.goto(appUrl(paths.stats));
      const group = page.getByRole('radiogroup', { name: 'Season' });
      const picker = page.getByRole('button', { name: /^Season/ });
      await expect(group.or(picker), at).toBeVisible();

      if (sheetAt.includes(width)) {
        // Too narrow for them after all: a sheet, with the names in full.
        await expect(group, at).toHaveCount(0);
        await picker.tap();
        const sheet = page.getByRole('dialog', { name: 'Season' });
        const choices = sheet.getByRole('list', { name: 'Seasons' }).getByRole('button');
        // (The selected one says so, to screen readers.)
        await expect(choices, at).toHaveText([
          /^All/,
          new RegExp(`^${newer}`),
          new RegExp(`^${older}`),
        ]);
        await choices.last().tap();
        await expect(sheet).toHaveCount(0);
        await expect(picker, at).toContainText(older);
      } else {
        const radios = group.getByRole('radio');
        await expect(radios, at).toHaveText(['All', newer, older]);
        const positions = () =>
          radios.evaluateAll((all) =>
            all.map((radio) => Math.round(radio.getBoundingClientRect().x)),
          );
        const before = await positions();
        for (const radio of await radios.all()) {
          // Selected, in bold: the widest a label gets.
          await radio.tap();
          await expect(radio).toBeChecked();
          expect(await radio.evaluate((el) => el.scrollWidth <= el.clientWidth), at).toBe(true);
          expect(await positions(), at).toEqual(before);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth), at).toBe(width);
    }
  }
});

test('with no finished games, the Stats tab leads to a new game', async ({ page }) => {
  await tabBar(page).getByRole('link', { name: 'Stats' }).tap();
  await expect(page.getByRole('heading', { name: 'No stats yet' })).toBeVisible();

  await page.getByRole('link', { name: 'Start a game' }).tap();
  await expectRoute(page, paths.newGame);
});
