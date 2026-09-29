import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute, IPHONE_SAFE_BOTTOM } from './support/app';
import { DEMO_LIVE_GAME_ID, demoGameId, exportAll, seedDemoData } from './support/data';
import {
  failNextSaves,
  failSpotSaves,
  keptSpots,
  keptTaps,
  keptTapSpots,
  lastAction,
  notSaved,
  shotCourt,
  startGame,
  statGrid,
  stats,
  tapCourt,
  tapStats,
  type CourtSpot,
} from './support/tracking';

// The shot chart on the live game screen (the Shot chart setting, on by default): a
// shot's button, then a tap on the court, marks where it was taken; the spot is saved
// with the shot (kept on the phone with it until then) and shows on the game report;
// and the court fits every iPhone with the stat buttons still big.

/** Where shots were taken, in feet from the basket. */
const ELBOW: CourtSpot = { x: -6, y: 13.75 };
const CORNER: CourtSpot = { x: 22.5, y: -2 };

/** A tap lands within a few inches of the spot aimed at (it maps through whole pixels). */
function expectNear(actual: CourtSpot | undefined, expected: CourtSpot) {
  expect(actual?.x).toBeCloseTo(expected.x, 0);
  expect(actual?.y).toBeCloseTo(expected.y, 0);
}

async function gameEvents(page: Page, gameId: string) {
  const data = await exportAll(page);
  return data.events.filter((event) => event.gameId === gameId);
}

test.describe('marking spots', () => {
  test.beforeEach(async ({ page }) => {
    await emulateIPhoneSafeArea(page);
  });

  test('a shot, then the court: the spot is saved with it and the game report maps it', async ({
    page,
  }) => {
    const gameId = await startGame(page);
    await tapStats(page, ['2PT Made']);
    // Saved at the tap, as ever; the court is an extra, optional tap.
    await expect.poll(async () => (await gameEvents(page, gameId)).length).toBe(1);
    await expect(lastAction(page)).toContainText('2PT Made · Q1');
    await expect(lastAction(page)).toContainText('Tap the court to mark the spot');

    await tapCourt(page, ELBOW);
    await expect(lastAction(page)).toContainText('Spot marked');
    await expect(shotCourt(page).getByText('2PT', { exact: true })).toBeVisible();
    await expect.poll(async () => (await gameEvents(page, gameId))[0]?.location).toBeTruthy();
    const [shot, ...others] = await gameEvents(page, gameId);
    expect(others).toEqual([]);
    expect(shot?.type).toBe('fg2_made');
    expectNear(shot?.location, ELBOW);
    await expect.poll(() => keptTaps(page)).toEqual([]);

    // End the game: its report maps the shot, with its spot.
    await page.getByRole('button', { name: 'End game' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Final score' });
    await sheet.getByRole('button', { name: 'End game' }).tap();
    await expectRoute(page, paths.gameReport(gameId));
    const shotChart = page.getByRole('region', { name: 'Shot chart' });
    await expect(
      shotChart.getByRole('img', { name: /^Shot chart: 1 shot on the map, 1 made \(100%\)\./ }),
    ).toBeVisible();
    await expect(shotChart.getByRole('img')).not.toHaveAccessibleName(/have a location/);
  });

  test('a shot that could not be saved keeps its spot, and both are saved once after a reload', async ({
    page,
  }) => {
    const gameId = await startGame(page);
    // IndexedDB stops taking new stats, as when WebKit loses its connection.
    await failNextSaves(page, 1000);
    await tapStats(page, ['3PT Miss']);
    await expect(notSaved(page)).toContainText('3PT Miss not saved');

    await tapCourt(page, CORNER);
    await expect(lastAction(page)).toContainText('Spot marked');
    // Kept on the phone with its tap.
    const [kept, ...more] = await keptTapSpots(page);
    expect(more).toEqual([]);
    expect(kept?.type).toBe('fg3_miss');
    expectNear(kept?.location, CORNER);

    // The app is relaunched mid-game, with writes working again.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'vs Westfield' })).toBeVisible();
    await expect.poll(async () => (await gameEvents(page, gameId)).length).toBe(1);
    await expect(notSaved(page)).toHaveCount(0);
    await expect.poll(() => keptTaps(page)).toEqual([]);
    // Once, with its spot, though both the app's start and the game screen saved it.
    await page.waitForTimeout(500);
    const saved = await gameEvents(page, gameId);
    expect(saved.map((event) => event.type)).toEqual(['fg3_miss']);
    expectNear(saved[0]?.location, CORNER);
    await expect(lastAction(page)).toContainText('3PT Miss · Q1');
    await expect(lastAction(page)).toContainText('Spot marked');
  });

  test('the court takes every touch as a tap (touch-action: none), and a tap with no shot to mark says so', async ({
    page,
  }) => {
    const gameId = await startGame(page);
    // So on an iPhone a finger that drifts still taps, and never scrolls or zooms.
    // (Chromium's emulation scrolls and zooms neither way, so only the CSS is checked.)
    await expect(shotCourt(page)).toHaveCSS('touch-action', 'none');
    await tapCourt(page, ELBOW);
    await expect(page.getByText('Tap 2PT or 3PT first')).toBeVisible();
    await tapStats(page, ['FT Made']);
    await tapCourt(page, ELBOW);
    await expect(page.getByText('Tap 2PT or 3PT first')).toBeVisible();
    // However often the court is tapped, the free throw has no spot.
    for (let tap = 0; tap < 3; tap++) await tapCourt(page, CORNER);
    await expect.poll(async () => (await gameEvents(page, gameId)).length).toBe(1);
    expect((await gameEvents(page, gameId))[0]?.location).toBeUndefined();
  });

  test("a shot deleted on the game report stays deleted after a relaunch, though its spot wasn't saved", async ({
    page,
  }) => {
    const gameId = await startGame(page);
    await tapStats(page, ['2PT Made', 'Def Reb', '3PT Miss']);
    await expect.poll(async () => (await gameEvents(page, gameId)).length).toBe(3);

    // The 3PT Miss is saved, but its spot can't be (nor on the automatic retry): the
    // spot is kept on the phone, on its own (its tap isn't kept: the shot is saved).
    await failSpotSaves(page, true);
    await tapCourt(page, CORNER);
    await expect(lastAction(page)).toContainText('Spot marked');
    const [kept, ...more] = await keptSpots(page);
    expect(more).toEqual([]);
    expectNear(kept?.location, CORNER);
    expect(await keptTaps(page)).toEqual([]);

    // End game: the spot still can't be saved, so the sheet says so. End anyway.
    await page.getByRole('button', { name: 'End game' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Final score' });
    await sheet.getByRole('button', { name: 'End game' }).tap();
    await expect(sheet.getByRole('alert')).toContainText("1 stat isn't saved yet");
    await sheet.getByRole('button', { name: 'End anyway' }).tap();
    await expectRoute(page, paths.gameReport(gameId));

    // Writes work again, and the parent deletes the 3PT Miss on the report: its kept
    // spot goes with it.
    await failSpotSaves(page, false);
    await page
      .getByRole('list', { name: '1st quarter plays' })
      .getByRole('button', { name: /3PT Miss/ })
      .tap();
    await page
      .getByRole('alertdialog', { name: 'Delete this stat?' })
      .getByRole('button', { name: 'Delete stat' })
      .tap();
    const left = ['fg2_made', 'dreb'];
    await expect
      .poll(async () => (await gameEvents(page, gameId)).map((event) => event.type))
      .toEqual(left);
    expect(await keptSpots(page)).toEqual([]);

    // The app is relaunched, and replays what it kept: the shot stays deleted.
    await page.reload();
    await expect(page.getByRole('region', { name: 'Shot chart' })).toBeVisible();
    await page.waitForTimeout(1000);
    expect((await gameEvents(page, gameId)).map((event) => event.type)).toEqual(left);
    expect(await keptSpots(page)).toEqual([]);
  });
});

// Installed-app viewports: the screen minus the status bar (the page starts below it).
// The smallest button height and label size (computed, in px) each must keep.
const DEVICES = [
  {
    name: 'iPhone',
    width: 390,
    height: 797,
    safeBottom: IPHONE_SAFE_BOTTOM,
    minButton: 72,
    minLabel: 16,
  },
  { name: 'iPhone SE', width: 375, height: 667 - 20, safeBottom: 0, minButton: 64, minLabel: 14 },
  {
    name: 'iPhone Pro Max',
    width: 430,
    height: 932 - 59,
    safeBottom: IPHONE_SAFE_BOTTOM,
    minButton: 72,
    minLabel: 16,
  },
];

/**
 * Each stat button's label and count font sizes (computed, in px), and whether its
 * count covers any word of its label.
 */
function statButtonType(page: Page) {
  return statGrid(page).evaluate((grid) =>
    Array.from(grid.querySelectorAll('button'), (button) => {
      const label = button.querySelector('[data-fit-label]');
      const count = button.querySelector('.tabular-nums');
      const countBox = count?.getBoundingClientRect();
      const words = Array.from(button.querySelectorAll('[data-fit-word]'), (word) => {
        const range = document.createRange();
        range.selectNodeContents(word);
        return range.getBoundingClientRect();
      });
      return {
        name: button.getAttribute('aria-label'),
        labelPx: label ? parseFloat(getComputedStyle(label).fontSize) : 0,
        countPx: count ? parseFloat(getComputedStyle(count).fontSize) : undefined,
        countCoversLabel:
          !!countBox &&
          words.some(
            (word) =>
              word.left < countBox.right &&
              word.right > countBox.left &&
              word.top < countBox.bottom &&
              word.bottom > countBox.top,
          ),
      };
    }),
  );
}

for (const device of DEVICES) {
  for (const finished of [false, true]) {
    const what = finished ? 'a finished game (with its banner)' : 'a live game';
    test(`with the court, fits the ${device.name} screen for ${what}, buttons still big`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: device.width, height: device.height });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 0, bottom: device.safeBottom, left: 0, right: 0 },
      });
      await page.goto('./');
      await seedDemoData(page, { liveGame: true });
      await page.goto(appUrl(paths.trackGame(finished ? demoGameId(10) : DEMO_LIVE_GAME_ID)));
      await expect(page.getByRole('heading', { level: 1, name: /^(vs|@) / })).toBeVisible();

      // Never scrolls.
      const size = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(size).toEqual({ scrollHeight: device.height, scrollWidth: device.width });

      // Every stat button at least as tall as promised, and on screen.
      const buttons = await statGrid(page).getByRole('button').all();
      expect(buttons).toHaveLength(16);
      for (const button of buttons) {
        const box = await button.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(80);
        expect(box?.height).toBeGreaterThanOrEqual(device.minButton);
        await expect(button).toBeInViewport({ ratio: 1 });
        const fits = await button.evaluate((element) => {
          const text = element.querySelector<HTMLElement>('[data-fit-label]');
          return !!text && text.scrollWidth <= text.clientWidth;
        });
        expect(fits).toBe(true);
      }

      // Big type still: labels, counts (two digits on the longest first words, "Charge"
      // and "Turn-", each clear of its label) and points.
      await tapStats(page, Array<string>(10).fill('Charge Taken'));
      await tapStats(page, Array<string>(10).fill('Turnover'));
      const type = await statButtonType(page);
      for (const button of type) {
        expect(button.labelPx, button.name ?? '').toBeGreaterThanOrEqual(device.minLabel);
        if (button.countPx !== undefined) {
          expect(button.countPx, button.name ?? '').toBeGreaterThanOrEqual(12);
        }
        expect(button.countCoversLabel, button.name ?? '').toBe(false);
      }
      expect(type.filter((button) => button.countPx !== undefined).length).toBeGreaterThan(8);
      const points = stats(page).getByRole('listitem').first().locator('.tabular-nums');
      expect(
        await points.evaluate((value) => parseFloat(getComputedStyle(value).fontSize)),
      ).toBeGreaterThanOrEqual(32);

      // The court: all on screen, between the stat strip and the buttons (clear of both,
      // its outline included), and deep enough to put a three at the top of the key.
      const court = shotCourt(page);
      await expect(court).toBeInViewport({ ratio: 1 });
      await expect(court).toHaveAttribute('viewBox', '-10 -10 520 290');
      const courtBox = await court.boundingBox();
      const strip = await stats(page).boundingBox();
      const firstButton = await buttons[0]?.boundingBox();
      if (!courtBox || !strip || !firstButton) throw new Error('Missing layout');
      expect(courtBox.y).toBeGreaterThanOrEqual(strip.y + strip.height + 4);
      expect(courtBox.y + courtBox.height + 4).toBeLessThanOrEqual(firstButton.y);
      expect(courtBox.width).toBeCloseTo(device.width - 16, 0);
      // The drawing fits its box (shorter boxes draw it narrower), never too small to tap.
      const drawn = Math.min(courtBox.width, (courtBox.height * 520) / 290);
      expect(drawn).toBeGreaterThanOrEqual(200);

      // The last-action line and the bottom bar stay below the buttons, clear of the
      // home indicator.
      const lastButton = await buttons.at(-1)?.boundingBox();
      const line = await lastAction(page).boundingBox();
      const bottom = await page.getByRole('button', { name: 'Log' }).boundingBox();
      if (!lastButton || !line || !bottom) throw new Error('Missing layout');
      expect(line.y).toBeGreaterThanOrEqual(lastButton.y + lastButton.height);
      expect(bottom.y).toBeGreaterThanOrEqual(line.y + line.height);
      expect(bottom.y + bottom.height).toBeLessThanOrEqual(device.height - device.safeBottom);
    });
  }
}
