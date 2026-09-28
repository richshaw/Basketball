import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute, IPHONE_SAFE_BOTTOM } from './support/app';
import { DEMO_LIVE_GAME_ID, demoGameId, exportAll, seedDemoData } from './support/data';
import {
  failNextSaves,
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

  test('taps on the court never zoom or scroll, and one with no shot to mark says so', async ({
    page,
  }) => {
    const gameId = await startGame(page);
    await expect(shotCourt(page)).toHaveCSS('touch-action', 'none');
    await tapCourt(page, ELBOW);
    await expect(page.getByText('Tap 2PT or 3PT first')).toBeVisible();
    await tapStats(page, ['FT Made']);
    await tapCourt(page, ELBOW);
    await expect(page.getByText('Tap 2PT or 3PT first')).toBeVisible();
    // Quick taps: the page stays put, and the free throw has no spot.
    for (let tap = 0; tap < 3; tap++) await tapCourt(page, CORNER);
    expect(await page.evaluate(() => [window.scrollY, window.visualViewport?.scale])).toEqual([
      0, 1,
    ]);
    await expect.poll(async () => (await gameEvents(page, gameId)).length).toBe(1);
    expect((await gameEvents(page, gameId))[0]?.location).toBeUndefined();
  });
});

// Installed-app viewports: the screen minus the status bar (the page starts below it).
const DEVICES = [
  { name: 'iPhone', width: 390, height: 797, safeBottom: IPHONE_SAFE_BOTTOM, minButton: 72 },
  { name: 'iPhone SE', width: 375, height: 667 - 20, safeBottom: 0, minButton: 64 },
  {
    name: 'iPhone Pro Max',
    width: 430,
    height: 932 - 59,
    safeBottom: IPHONE_SAFE_BOTTOM,
    minButton: 72,
  },
];

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
