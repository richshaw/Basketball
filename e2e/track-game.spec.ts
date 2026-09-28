import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute, IPHONE_SAFE_BOTTOM } from './support/app';
import { DEMO_LIVE_GAME_ID, exportAll, seedDemoData } from './support/data';

// The live game screen in a real browser: fast taps, undo, a reload mid-game, ending
// the game, and a layout that fits the phone without scrolling.

const statGrid = (page: Page) => page.getByRole('group', { name: 'Record a stat' });
const stats = (page: Page) => page.getByRole('list', { name: 'Game stats' });
const lastAction = (page: Page) => page.getByRole('status', { name: 'Last action' });

/** Waits until the stat strip says each text (what a screen reader hears), e.g. 'Points: 9'. */
async function expectStats(page: Page, ...texts: string[]) {
  for (const text of texts)
    await expect(stats(page).getByText(text, { exact: true })).toBeAttached();
}

async function gameEventTypes(page: Page): Promise<string[]> {
  const data = await exportAll(page);
  return data.events.filter((event) => event.gameId === DEMO_LIVE_GAME_ID).map((e) => e.type);
}

/** The demo live game (Q3) with all of its stats undone. */
async function openClearedLiveGame(page: Page) {
  await page.goto('./');
  await seedDemoData(page, { liveGame: true });
  await page.goto(appUrl(paths.trackGame(DEMO_LIVE_GAME_ID)));
  await expect(page.getByRole('heading', { level: 1, name: 'vs Westfield' })).toBeVisible();
  // Far more Undo taps than the demo game has stats: each removes the latest one.
  await statGrid(page)
    .getByRole('button', { name: 'Undo last stat' })
    .evaluate((undo: HTMLElement) => Array.from({ length: 80 }, () => undo.click()));
  await expect(lastAction(page)).toHaveText('Nothing to undo');
  expect(await gameEventTypes(page)).toEqual([]);
  await expectStats(page, 'Points: 0');
}

/** Taps a stat button by touch, as fast as the browser takes them (no waiting in between). */
async function tapStats(page: Page, labels: readonly string[]) {
  const centers = new Map<string, { x: number; y: number }>();
  for (const label of new Set(labels)) {
    const box = await statGrid(page)
      .getByRole('button', { name: label, exact: true })
      .boundingBox();
    if (!box) throw new Error(`No button for ${label}`);
    centers.set(label, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  for (const label of labels) {
    const center = centers.get(label);
    if (center) await page.touchscreen.tap(center.x, center.y);
  }
}

const TAPS = [
  '2PT Made',
  '2PT Made',
  '3PT Made',
  '2PT Miss',
  'FT Made',
  'FT Miss',
  'FT Made',
  'Off Reb',
  'Def Reb',
  'Def Reb',
  'Assist',
  'Steal',
  'Block',
  'Turnover',
  'Foul',
  'Foul',
  'Deflection',
  'Charge Taken',
  '3PT Miss',
  'Assist',
] as const;

const TAP_TYPES = [
  'fg2_made',
  'fg2_made',
  'fg3_made',
  'fg2_miss',
  'ft_made',
  'ft_miss',
  'ft_made',
  'oreb',
  'dreb',
  'dreb',
  'ast',
  'stl',
  'blk',
  'tov',
  'foul',
  'foul',
  'deflection',
  'charge',
  'fg3_miss',
  'ast',
];

test.beforeEach(async ({ page }) => {
  await emulateIPhoneSafeArea(page);
});

test('records fast taps, undoes, survives a reload and ends the game', async ({ page }) => {
  await openClearedLiveGame(page);

  await tapStats(page, TAPS);
  await expect(lastAction(page)).toContainText('Assist · Q3');
  await expectStats(
    page,
    'Points: 9',
    'Rebounds: 3',
    'Assists: 2',
    'Steals: 1',
    'Blocks: 1',
    'Turnovers: 1',
    'Fouls: 2',
    'Field goals: 3 of 5',
    '3-pointers: 1 of 2',
    'Free throws: 2 of 3',
  );
  await expect.poll(() => gameEventTypes(page)).toEqual(TAP_TYPES);
  await expect(
    statGrid(page).getByRole('button', { name: '2PT Made' }),
  ).toHaveAccessibleDescription('2 this game');

  // The grid's Undo takes back the latest stat.
  await statGrid(page).getByRole('button', { name: 'Undo last stat' }).tap();
  await expect(lastAction(page)).toHaveText('Removed Assist');
  await expectStats(page, 'Assists: 1');

  // The line's Undo takes back the stat it shows, even on a double tap.
  await tapStats(page, ['3PT Made']);
  await expect(lastAction(page)).toContainText('3PT Made · Q3');
  await expectStats(page, 'Points: 12');
  await lastAction(page).getByRole('button', { name: 'Undo' }).dblclick();
  await expect(lastAction(page)).toHaveText('Removed 3PT Made');
  await expectStats(page, 'Points: 9');
  await expect.poll(() => gameEventTypes(page)).toEqual(TAP_TYPES.slice(0, -1));

  // A new period, then the app is relaunched mid-game: everything is still there.
  await page.getByRole('button', { name: 'Next period' }).tap();
  await expect(page.getByRole('button', { name: 'Period Q4' })).toBeVisible();
  await tapStats(page, ['FT Made']);
  await expectStats(page, 'Points: 10');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'vs Westfield' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Period Q4' })).toBeVisible();
  await expectStats(page, 'Points: 10', 'Free throws: 3 of 4', 'Assists: 1', 'Fouls: 2');
  await expect(lastAction(page)).toContainText('FT Made · Q4');

  // End the game with a score: the report replaces this screen.
  await page.getByRole('button', { name: 'End game' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Final score' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Our team').fill('52');
  await sheet.getByLabel('Opponent').fill('47');
  await sheet.getByRole('button', { name: 'End game' }).tap();
  await expectRoute(page, paths.gameReport(DEMO_LIVE_GAME_ID));
  const saved = await exportAll(page);
  expect(saved.games.find((game) => game.id === DEMO_LIVE_GAME_ID)).toMatchObject({
    status: 'final',
    teamScore: 52,
    opponentScore: 47,
  });
});

test('the log deletes a stat once confirmed', async ({ page }) => {
  await openClearedLiveGame(page);
  await tapStats(page, ['Steal', '2PT Made', 'Block']);
  await expectStats(page, 'Points: 2');

  await page.getByRole('button', { name: 'Log' }).tap();
  const log = page.getByRole('dialog', { name: 'Stat log' });
  await expect(log.getByRole('listitem')).toHaveText([/^Block/, /^2PT Made/, /^Steal/]);
  await log.getByRole('button', { name: /^2PT Made/ }).tap();
  const confirm = page.getByRole('alertdialog', { name: 'Delete 2PT Made (Q3)?' });
  await confirm.getByRole('button', { name: 'Delete' }).tap();
  await expect(log.getByRole('listitem')).toHaveText([/^Block/, /^Steal/]);
  await expectStats(page, 'Points: 0');
  expect(await gameEventTypes(page)).toEqual(['stl', 'blk']);
});

for (const device of [
  { name: 'iPhone', width: 390, height: 797, safeBottom: IPHONE_SAFE_BOTTOM },
  { name: 'iPhone SE', width: 375, height: 667, safeBottom: 0 },
  { name: 'iPhone Pro Max', width: 430, height: 932, safeBottom: IPHONE_SAFE_BOTTOM },
]) {
  test(`fits the ${device.name} screen without scrolling, every button big and clear`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: device.width, height: device.height });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {
      insets: { top: 0, bottom: device.safeBottom, left: 0, right: 0 },
    });
    await page.goto('./');
    await seedDemoData(page, { liveGame: true });
    await page.goto(appUrl(paths.trackGame(DEMO_LIVE_GAME_ID)));
    await expect(statGrid(page)).toBeVisible();

    const main = page.getByRole('main');
    await expect(main).toHaveCSS('touch-action', 'manipulation');
    await expect(main).toHaveCSS('user-select', 'none');
    const size = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(size).toEqual({ scrollHeight: device.height, scrollWidth: device.width });

    const buttons = await statGrid(page).getByRole('button').all();
    expect(buttons).toHaveLength(16);
    for (const button of buttons) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(80);
      expect(box?.height).toBeGreaterThanOrEqual(80);
      await expect(button).toBeInViewport({ ratio: 1 });
      // No label spills out of its button, and none is more than two lines.
      const label = await button.evaluate((element) => {
        const text = element.querySelector<HTMLElement>('[data-fit-label]');
        if (!text) return null;
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
        return {
          fits: text.scrollWidth <= text.clientWidth && text.clientWidth <= element.clientWidth,
          lines: Math.round(text.getBoundingClientRect().height / lineHeight),
        };
      });
      expect(label?.fits).toBe(true);
      expect(label?.lines).toBeLessThanOrEqual(2);
    }

    // The last-action line sits between the grid and the bottom bar, clear of both,
    // and the bottom bar clears the home indicator.
    const lastButton = await buttons.at(-1)?.boundingBox();
    const line = await lastAction(page).boundingBox();
    const endGame = await page.getByRole('button', { name: 'End game' }).boundingBox();
    if (!lastButton || !line || !endGame) throw new Error('Missing layout');
    expect(line.y).toBeGreaterThanOrEqual(lastButton.y + lastButton.height);
    expect(endGame.y).toBeGreaterThanOrEqual(line.y + line.height);
    expect(endGame.y + endGame.height).toBeLessThanOrEqual(device.height - device.safeBottom);
  });
}
