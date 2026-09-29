import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute, IPHONE_SAFE_BOTTOM } from './support/app';
import { DEMO_LIVE_GAME_ID, demoGameId, exportAll, seedDemoData } from './support/data';
import {
  doubleTap,
  expectStats,
  failNextSaves,
  failStatReads,
  keptTaps,
  lastAction,
  lastActionFits,
  lineButton,
  notSaved,
  readFailedNote,
  setShotChart,
  shotCourt,
  showPageAgain,
  startGame,
  statGrid,
  tapStats,
} from './support/tracking';

// The live game screen in a real browser: fast taps, undo, double taps, failed saves
// (kept on the phone and saved after a reload), a reload mid-game, ending the game,
// and a layout that fits the phone without scrolling.

async function gameEvents(page: Page, gameId: string) {
  const data = await exportAll(page);
  return data.events.filter((event) => event.gameId === gameId);
}

async function gameEventTypes(page: Page, gameId: string): Promise<string[]> {
  return (await gameEvents(page, gameId)).map((event) => event.type);
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
  const gameId = await startGame(page);

  await tapStats(page, TAPS);
  await expect(lastAction(page)).toContainText('Assist · Q1');
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
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(TAP_TYPES);
  await expect(
    statGrid(page).getByRole('button', { name: '2PT Made' }),
  ).toHaveAccessibleDescription('2 this game');

  // The grid's Undo takes back the latest stat.
  await statGrid(page).getByRole('button', { name: 'Undo last stat' }).tap();
  await expect(lastAction(page)).toHaveText('Removed Assist');
  await expectStats(page, 'Assists: 1');

  // The line's Undo takes back the stat it shows, even on a double tap.
  await tapStats(page, ['3PT Made']);
  await expect(lastAction(page)).toContainText('3PT Made · Q1');
  await expectStats(page, 'Points: 12');
  await expect(lineButton(page)).toBeEnabled();
  await doubleTap(page, 'Undo');
  await expect(lastAction(page)).toHaveText('Removed 3PT Made');
  await expectStats(page, 'Points: 9');
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(TAP_TYPES.slice(0, -1));

  // A new period, then the app is relaunched mid-game: everything is still there.
  await page.getByRole('button', { name: 'Next period' }).tap();
  await expect(page.getByRole('button', { name: 'Period Q2' })).toBeVisible();
  await tapStats(page, ['FT Made']);
  await expectStats(page, 'Points: 10');
  await expect.poll(async () => (await gameEvents(page, gameId)).at(-1)?.period).toBe(2);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'vs Westfield' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Period Q2' })).toBeVisible();
  await expectStats(page, 'Points: 10', 'Free throws: 3 of 4', 'Assists: 1', 'Fouls: 2');
  await expect(lastAction(page)).toContainText('FT Made · Q2');

  // End the game with a score: the report replaces this screen.
  await page.getByRole('button', { name: 'End game' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Final score' });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Our team').fill('52');
  await sheet.getByLabel('Opponent').fill('47');
  await sheet.getByRole('button', { name: 'End game' }).tap();
  await expectRoute(page, paths.gameReport(gameId));
  const saved = await exportAll(page);
  expect(saved.games.find((game) => game.id === gameId)).toMatchObject({
    status: 'final',
    teamScore: 52,
    opponentScore: 47,
  });
});

test("a double tap on the grid's Undo removes one stat", async ({ page }) => {
  const gameId = await startGame(page);
  await tapStats(page, ['Steal', 'Assist', 'Block']);
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['stl', 'ast', 'blk']);

  await doubleTap(page, 'Undo last stat');
  await expect(lastAction(page)).toHaveText('Removed Block');
  await page.waitForTimeout(500);
  expect(await gameEventTypes(page, gameId)).toEqual(['stl', 'ast']);
  await expectStats(page, 'Steals: 1', 'Assists: 1', 'Blocks: 0');
});

test('a double tap on Next moves one period, and a stat right after lands there', async ({
  page,
}) => {
  const gameId = await startGame(page);
  await doubleTap(page, 'Next period');
  // Tapped right after, as a parent would. (By then the move may well be saved; the
  // next test taps in the same moment.)
  await tapStats(page, ['Steal']);
  await expect(lastAction(page)).toContainText('Steal · Q2');
  await expect(page.getByRole('button', { name: 'Period Q2' })).toBeVisible();
  await expect.poll(async () => (await gameEvents(page, gameId)).map((e) => e.period)).toEqual([2]);
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: 'Period Q2' })).toBeVisible();
  const saved = await exportAll(page);
  expect(saved.games.find((game) => game.id === gameId)).toMatchObject({ status: 'live' });
});

test('a stat tapped in the same moment as Next lands in the new period', async ({ page }) => {
  const gameId = await startGame(page);
  // Both taps in one task, so the stat is recorded before the move can have been saved
  // (let alone read back from the database).
  await page.evaluate(() => {
    const tap = (selector: string) => document.querySelector<HTMLElement>(selector)?.click();
    tap('button[aria-label="Next period"]');
    tap('[role="group"][aria-label="Record a stat"] button[aria-label="Steal"]');
  });
  await expect(lastAction(page)).toContainText('Steal · Q2');
  await expect(page.getByRole('button', { name: 'Period Q2' })).toBeVisible();
  await expect.poll(async () => (await gameEvents(page, gameId)).map((e) => e.period)).toEqual([2]);
});

test('a stat that could not be saved stays on screen and is saved by the next tap', async ({
  page,
}) => {
  const gameId = await startGame(page);
  // The save and the retry the next tap makes both fail, then the database recovers.
  await failNextSaves(page, 2);
  await tapStats(page, ['Steal']);
  await expect(notSaved(page)).toContainText('Steal not saved');
  await expect(lastAction(page)).toHaveText('Steal not saved');

  await tapStats(page, ['Assist']);
  await expect(lastAction(page)).toContainText('Assist · Q1');
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['ast']);
  await expect(notSaved(page)).toContainText('Steal not saved');

  // Tapping another stat retries it first. Saved late, it still sorts where it was
  // tapped: before the Assist.
  await tapStats(page, ['Block']);
  await expect(notSaved(page)).toHaveCount(0);
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['stl', 'ast', 'blk']);
  await expectStats(page, 'Steals: 1', 'Assists: 1', 'Blocks: 1');
});

test('a stat that could not be saved is saved again on its own', async ({ page }) => {
  const gameId = await startGame(page);
  await failNextSaves(page, 1);
  await tapStats(page, ['Deflection']);
  await expect(notSaved(page)).toContainText('Deflection not saved');
  // About a second later, with nothing else tapped.
  await expect(notSaved(page)).toHaveCount(0, { timeout: 5000 });
  expect(await gameEventTypes(page, gameId)).toEqual(['deflection']);
  await expect(lastAction(page)).toContainText('Deflection · Q1');
});

test('double-tapping Retry saves the stat and leaves it saved', async ({ page }) => {
  const gameId = await startGame(page);
  // The save and its automatic retry fail; Retry works.
  await failNextSaves(page, 2);
  await tapStats(page, ['Steal']);
  await expect(notSaved(page)).toContainText('Steal not saved');
  await page.waitForTimeout(1500);
  await expect(notSaved(page)).toContainText('Steal not saved');

  await doubleTap(page, 'Retry');
  await expect(notSaved(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(await gameEventTypes(page, gameId)).toEqual(['stl']);
  await expectStats(page, 'Steals: 1');
});

test('a stat that could not be saved is kept on the phone, and saved once after a reload', async ({
  page,
}) => {
  const gameId = await startGame(page);
  await tapStats(page, ['Assist']);
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['ast']);

  // IndexedDB stops taking writes, as when WebKit loses its connection in the background.
  await failNextSaves(page, 1000);
  await tapStats(page, ['Steal']);
  await expect(notSaved(page)).toContainText('Steal not saved');
  await expect(notSaved(page)).toContainText(
    "It's kept on this phone and will be saved automatically.",
  );
  await expectStats(page, 'Steals: 1');
  expect(await keptTaps(page)).toHaveLength(1);

  // The app is relaunched mid-game, with writes working again.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'vs Westfield' })).toBeVisible();
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['ast', 'stl']);
  await expect(notSaved(page)).toHaveCount(0);
  await expectStats(page, 'Steals: 1', 'Assists: 1');
  await expect(lastAction(page)).toContainText('Steal · Q1');
  // Once, though both the app's start and the live game screen saved it.
  await page.waitForTimeout(500);
  expect(await gameEventTypes(page, gameId)).toEqual(['ast', 'stl']);
  expect(await keptTaps(page)).toEqual([]);
});

test('ending the game with a stat not saved says so, and End anyway still saves it later', async ({
  page,
}) => {
  const gameId = await startGame(page);
  await failNextSaves(page, 1000);
  await tapStats(page, ['Block']);
  await expect(notSaved(page)).toContainText('Block not saved');

  await page.getByRole('button', { name: 'End game' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Final score' });
  await sheet.getByLabel('Our team').fill('50');
  await sheet.getByRole('button', { name: 'End game' }).tap();
  await expect(sheet.getByRole('alert')).toHaveText(
    "1 stat isn't saved yet. It's kept on this phone and will be saved automatically.",
  );
  await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();
  await sheet.getByRole('button', { name: 'End anyway' }).tap();
  await expectRoute(page, paths.gameReport(gameId));
  const ended = await exportAll(page);
  expect(ended.games.find((game) => game.id === gameId)).toMatchObject({ status: 'final' });
  expect(await gameEventTypes(page, gameId)).toEqual([]);

  // The next launch saves it, once, and the report shows it.
  await page.reload();
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['blk']);
  await expect(
    page.getByRole('list', { name: '1st quarter plays' }).getByRole('button', { name: /Block/ }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(await gameEventTypes(page, gameId)).toEqual(['blk']);
  expect(await keptTaps(page)).toEqual([]);
});

test('a stat not saved when the game ended is saved later on its own, with no relaunch', async ({
  page,
}) => {
  const gameId = await startGame(page);
  await failNextSaves(page, 1000);
  await tapStats(page, ['Block']);
  await expect(notSaved(page)).toContainText('Block not saved');
  await page.getByRole('button', { name: 'End game' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Final score' });
  await sheet.getByRole('button', { name: 'End game' }).tap();
  await sheet.getByRole('button', { name: 'End anyway' }).tap();
  await expectRoute(page, paths.gameReport(gameId));
  expect(await gameEventTypes(page, gameId)).toEqual([]);

  // The database takes writes again, and the app comes back to the front: the stat is
  // saved by the app-wide retry, and the report shows it. No live game screen, no reload.
  await failNextSaves(page, 0);
  await showPageAgain(page);
  await expect(
    page.getByRole('list', { name: '1st quarter plays' }).getByRole('button', { name: /Block/ }),
  ).toBeVisible();
  expect(await gameEventTypes(page, gameId)).toEqual(['blk']);
  expect(await keptTaps(page)).toEqual([]);
});

test('a failed read keeps the screen up with a calm note, taps still count, and it reads again', async ({
  page,
}) => {
  const gameId = await startGame(page);
  await tapStats(page, ['Steal']);
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['stl']);

  // Reading the stats fails from now on: the Assist is saved, but can't be read back.
  await failStatReads(page);
  await tapStats(page, ['Assist']);
  await expect(readFailedNote(page)).toBeVisible();
  await expect(page.getByText('Your taps are kept on this phone.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
  await expect(statGrid(page)).toBeVisible();
  await expectStats(page, 'Steals: 1', 'Assists: 1');
  // Taps still count.
  await tapStats(page, ['Block']);
  await expectStats(page, 'Blocks: 1');
  await expect(lastAction(page)).toContainText('Block · Q1');

  // Reads work again, and the app comes back to the front: it reads again, no reload.
  await failStatReads(page, false);
  await showPageAgain(page);
  await expect(readFailedNote(page)).toHaveCount(0);
  await expectStats(page, 'Steals: 1', 'Assists: 1', 'Blocks: 1');
  expect(await gameEventTypes(page, gameId)).toEqual(['stl', 'ast', 'blk']);
});

test('Reload, offered while the stats cannot be read, loses no tap', async ({ page }) => {
  const gameId = await startGame(page);
  await failStatReads(page);
  await tapStats(page, ['Steal']);
  await expect(readFailedNote(page)).toBeVisible();
  // Saves fail now too (the connection is lost): the Block is only on the phone.
  await failNextSaves(page, 1000);
  await tapStats(page, ['Block']);
  await expectStats(page, 'Steals: 1', 'Blocks: 1');
  expect(await keptTaps(page)).toHaveLength(1);
  await expect(readFailedNote(page)).toBeVisible();

  await page.getByRole('button', { name: 'Reload' }).tap();
  await expect(page.getByRole('heading', { level: 1, name: 'vs Westfield' })).toBeVisible();
  await expect(readFailedNote(page)).toHaveCount(0);
  await expectStats(page, 'Steals: 1', 'Blocks: 1');
  await expect.poll(() => gameEventTypes(page, gameId)).toEqual(['stl', 'blk']);
  await expect.poll(() => keptTaps(page)).toEqual([]);
});

test('the log deletes a stat once confirmed', async ({ page }) => {
  const gameId = await startGame(page);
  await tapStats(page, ['Steal', '2PT Made', 'Block']);
  await expectStats(page, 'Points: 2');

  await page.getByRole('button', { name: 'Log' }).tap();
  const log = page.getByRole('dialog', { name: 'Stat log' });
  await expect(log.getByRole('listitem')).toHaveText([/^Block/, /^2PT Made/, /^Steal/]);
  await log.getByRole('button', { name: /^2PT Made/ }).tap();
  const confirm = page.getByRole('alertdialog', { name: 'Delete 2PT Made (Q1)?' });
  await confirm.getByRole('button', { name: 'Delete' }).tap();
  await expect(log.getByRole('listitem')).toHaveText([/^Block/, /^Steal/]);
  await expectStats(page, 'Points: 0');
  expect(await gameEventTypes(page, gameId)).toEqual(['stl', 'blk']);
});

test('a stat tapped just after a sheet closes counts: the sheet takes no taps as it slides away', async ({
  page,
}) => {
  const gameId = await startGame(page);
  const periodButton = page.getByRole('button', { name: /^Period Q\d$/ });
  /** Each way she closes a sheet on this screen, from opening it to the tap that closes it. */
  const ways: [string, () => Promise<void>][] = [
    [
      'picking a period',
      async () => {
        const next = (await periodButton.getAttribute('aria-label')) === 'Period Q1' ? 'Q2' : 'Q1';
        await periodButton.tap();
        const sheet = page.getByRole('dialog', { name: 'Period' });
        await sheet.getByRole('button', { name: next, exact: true }).tap();
      },
    ],
    [
      "the log's X",
      async () => {
        await page.getByRole('button', { name: 'Log' }).tap();
        const log = page.getByRole('dialog', { name: 'Stat log' });
        await log.getByRole('button', { name: 'Close' }).tap();
      },
    ],
    [
      'a tap outside the log',
      async () => {
        await page.getByRole('button', { name: 'Log' }).tap();
        await expect(page.getByRole('dialog', { name: 'Stat log' })).toBeVisible();
        // The dimmed strip above the sheet.
        await page.touchscreen.tap(195, 8);
      },
    ],
    [
      'Keep tracking, after End game',
      async () => {
        await page.getByRole('button', { name: 'End game' }).tap();
        const sheet = page.getByRole('dialog', { name: 'Final score' });
        await sheet.getByRole('button', { name: 'Keep tracking' }).tap();
      },
    ],
  ];

  let assists = 0;
  for (const [way, closeSheet] of ways) {
    for (const delayMs of [0, 50, 150]) {
      await closeSheet();
      // Well within the sheet's 200 ms slide-out.
      if (delayMs > 0) await page.waitForTimeout(delayMs);
      await tapStats(page, ['Assist']);
      assists += 1;
      // Counted, and nothing else: the tap that closed the sheet hit nothing under it.
      await expect
        .poll(() => gameEventTypes(page, gameId), {
          message: `${way}, then Assist ${delayMs} ms later`,
        })
        .toEqual(Array<string>(assists).fill('ast'));
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  }
});

// An ordinary opponent's name fits the title whole: 16 characters on an iPhone SE, 18 at
// 390 points. The back link is then only its chevron, and every control in the bar is
// still a full tap target.
for (const device of [
  { name: 'an iPhone SE', width: 375, height: 667 - 20, opponent: 'Central Catholic' },
  { name: 'an iPhone', width: 390, height: 797, opponent: 'Lakeview Christian' },
]) {
  test(`the title shows an ordinary opponent's name whole on ${device.name}`, async ({ page }) => {
    await page.setViewportSize({ width: device.width, height: device.height });
    await startGame(page, device.opponent);
    const title = page.getByRole('heading', { level: 1, name: `vs ${device.opponent}` });
    const whole = (locator: typeof title) =>
      locator.evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(await whole(title)).toBe(true);
    expect(await title.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');

    const controls = [
      page.getByRole('link', { name: 'Games' }),
      page.getByRole('button', { name: /^Period Q\d$/ }),
      page.getByRole('button', { name: 'Next period' }),
    ];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await expect(page.getByRole('link', { name: 'Games' })).toHaveText('', { useInnerText: true });

    // A finished game says so under the title, whole too.
    await page.getByRole('button', { name: 'End game' }).tap();
    await page
      .getByRole('dialog', { name: 'Final score' })
      .getByRole('button', { name: 'End game' })
      .tap();
    await page.getByRole('link', { name: 'Add or fix stats' }).tap();
    const note = page.getByText('Finished game', { exact: true });
    await expect(note).toBeVisible();
    expect(await whole(note)).toBe(true);
    expect(await whole(title)).toBe(true);
  });
}

// Installed-app viewports: the screen minus the status bar (the page starts below it).
const DEVICES = [
  { name: 'iPhone', width: 390, height: 797, safeBottom: IPHONE_SAFE_BOTTOM },
  { name: 'iPhone SE', width: 375, height: 667 - 20, safeBottom: 0 },
  { name: 'iPhone Pro Max', width: 430, height: 932 - 59, safeBottom: IPHONE_SAFE_BOTTOM },
];

// With the Shot chart setting off: no court (e2e/track-shots.spec.ts has the layout with it).
for (const device of DEVICES) {
  for (const finished of [false, true]) {
    const what = finished ? 'a finished game (with its note)' : 'a live game';
    test(`fits the ${device.name} screen for ${what}, every button big and clear`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: device.width, height: device.height });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 0, bottom: device.safeBottom, left: 0, right: 0 },
      });
      await page.goto('./');
      await seedDemoData(page, { liveGame: true });
      await setShotChart(page, false);
      await page.goto(appUrl(paths.trackGame(finished ? demoGameId(10) : DEMO_LIVE_GAME_ID)));
      await expect(page.getByRole('heading', { level: 1, name: /^(vs|@) / })).toBeVisible();
      await expect(page.getByText('Finished game', { exact: true })).toHaveCount(finished ? 1 : 0);
      await expect(shotCourt(page)).toHaveCount(0);

      const main = page.getByRole('main');
      await expect(main).toHaveCSS('touch-action', 'pan-x pan-y');
      await expect(main).toHaveCSS('user-select', 'none');
      const size = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(size).toEqual({ scrollHeight: device.height, scrollWidth: device.width });

      const buttons = await statGrid(page).getByRole('button').all();
      expect(buttons).toHaveLength(16);
      const fontSizes: number[] = [];
      for (const button of buttons) {
        const box = await button.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(80);
        // Comfortably big even on the smallest iPhone.
        expect(box?.height).toBeGreaterThanOrEqual(72);
        await expect(button).toBeInViewport({ ratio: 1 });
        // No label spills out of its button, and none is more than two lines.
        const label = await button.evaluate((element) => {
          const text = element.querySelector<HTMLElement>('[data-fit-label]');
          if (!text) return null;
          const style = getComputedStyle(text);
          return {
            fits: text.scrollWidth <= text.clientWidth && text.clientWidth <= element.clientWidth,
            lines: Math.round(text.getBoundingClientRect().height / parseFloat(style.lineHeight)),
            fontSize: style.fontSize,
          };
        });
        expect(label?.fits).toBe(true);
        expect(label?.lines).toBeLessThanOrEqual(2);
        if (label) fontSizes.push(parseFloat(label.fontSize));
      }
      // Every label the same size: none shrunk on its own to fit a long word.
      expect(Math.max(...fontSizes) - Math.min(...fontSizes)).toBeLessThan(0.1);

      // The last-action line sits between the grid and the bottom bar, clear of both,
      // and the bottom bar clears the home indicator.
      const lastButton = await buttons.at(-1)?.boundingBox();
      const line = await lastAction(page).boundingBox();
      const bottom = await page.getByRole('button', { name: 'Log' }).boundingBox();
      if (!lastButton || !line || !bottom) throw new Error('Missing layout');
      expect(line.y).toBeGreaterThanOrEqual(lastButton.y + lastButton.height);
      expect(bottom.y).toBeGreaterThanOrEqual(line.y + line.height);
      expect(bottom.y + bottom.height).toBeLessThanOrEqual(device.height - device.safeBottom);

      // It says all of a stat's longest note, fouled out (five fouls or more), next to Undo.
      await tapStats(page, Array<string>(5).fill('Foul'));
      await expect(lastAction(page)).toHaveText(/^Foul · Q\d · fouled out$/);
      await expect(lineButton(page)).toBeInViewport({ ratio: 1 });
      expect(await lastActionFits(page)).toBe(true);
    });
  }
}
