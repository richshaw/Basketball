import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, expectRoute, IPHONE_SAFE_BOTTOM, IPHONE_VIEWPORT } from './support/app';
import { demoGameId, seedDemoData } from './support/data';
import {
  expectAllSaved,
  failNextSaves,
  failStatDeletes,
  failStatReads,
  lastAction,
  notSaved,
  readFailedNote,
  setShotChart,
  shotCourt,
  startGame,
  stats,
  tapCourt,
  type CourtSpot,
} from './support/tracking';

// Screenshots of the live game screen in its main states, at the typical iPhone size
// and the smallest and largest ones (as installed apps: the status bar is above the
// page), with the Shot chart setting on (the default: the court above the buttons)
// and off. Run with `npm run screenshots` (SCREENSHOT_DIR picks the folder).

interface Device {
  width: number;
  height: number;
  /** Home indicator inset; 0 on phones with a home button. */
  safeBottom: number;
}

const IPHONE: Device = { ...IPHONE_VIEWPORT, safeBottom: IPHONE_SAFE_BOTTOM };
const IPHONE_SE: Device = { width: 375, height: 667 - 20, safeBottom: 0 };
const IPHONE_PRO_MAX: Device = { width: 430, height: 932 - 59, safeBottom: IPHONE_SAFE_BOTTOM };

/** Stands for a tap on "Next" (period) in GAME_TAPS. */
const NEXT_PERIOD = 'Next period';

/**
 * A realistic first three quarters, as the parent would tap it: stat buttons, Next,
 * and (spots, in feet from the basket) where most shots were taken, marked on the
 * court right after the shot's button when the court is shown.
 */
const GAME_TAPS: readonly (string | CourtSpot)[] = [
  '2PT Made',
  { x: 1.5, y: 3 },
  'Def Reb',
  'Assist',
  '2PT Miss',
  { x: -9, y: 11 },
  'Off Reb',
  '2PT Made',
  { x: -0.5, y: 1.5 },
  'Foul',
  'FT Made',
  'FT Miss',
  'Steal',
  NEXT_PERIOD,
  '3PT Made',
  { x: 16, y: 15 },
  'Turnover',
  'Def Reb',
  '2PT Miss',
  { x: 7, y: 13 },
  'Block',
  'Deflection',
  'Foul',
  'Assist',
  'FT Made',
  'FT Made',
  NEXT_PERIOD,
  '2PT Made',
  { x: -4, y: 8 },
  'Def Reb',
  '3PT Miss',
  { x: -22.5, y: -2 },
  'Charge Taken',
  'Steal',
  '2PT Made',
  'Foul',
];

async function emulateDevice(page: Page, device: Device) {
  await page.setViewportSize({ width: device.width, height: device.height });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 0, bottom: device.safeBottom, left: 0, right: 0 },
  });
}

async function openTracking(page: Page, gameId: string) {
  await page.goto('about:blank');
  await page.goto(appUrl(paths.trackGame(gameId)));
  await expectRoute(page, paths.trackGame(gameId));
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

function tapStat(page: Page, name: string) {
  return page
    .getByRole('group', { name: 'Record a stat' })
    .getByRole('button', { name, exact: true })
    .tap();
}

/** A game just started from the New game form. */
async function freshGame(page: Page) {
  await startGame(page);
  await expect(lastAction(page)).toHaveText('Tap a button to record a stat');
}

async function midGame(page: Page) {
  await startGame(page);
  const withCourt = (await shotCourt(page).count()) > 0;
  for (const tap of GAME_TAPS) {
    if (typeof tap !== 'string') {
      if (withCourt) await tapCourt(page, tap);
    } else if (tap === NEXT_PERIOD) {
      // Clear of the double-tap guard on Next.
      await page.waitForTimeout(450);
      await page.getByRole('button', { name: 'Next period' }).tap();
    } else {
      await tapStat(page, tap);
    }
  }
  await expect(stats(page).getByText('Points: 14')).toBeAttached();
  await expect(lastAction(page)).toContainText('Foul · Q3');
  await expectAllSaved(page);
}

/**
 * Mid-game, the saved stats can't be read any more (as when WebKit has lost its
 * IndexedDB connection): the next tap is saved, but can't be read back.
 */
async function readFailed(page: Page) {
  await midGame(page);
  await failStatReads(page);
  await page
    .getByRole('group', { name: 'Record a stat' })
    .getByRole('button', { name: 'Steal' })
    .tap();
  await expect(readFailedNote(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
}

/** Mid-game, an Undo that couldn't be done: the stat still counts, with Try again. */
async function undoFailed(page: Page) {
  await midGame(page);
  await failStatDeletes(page, true);
  await page.getByRole('button', { name: 'Undo last stat' }).tap();
  await expect(lastAction(page)).toHaveText("Couldn't undo");
}

/** A finished game being corrected: one more foul puts her in foul trouble (4). */
async function finishedGame(page: Page) {
  await page.goto('./');
  // (The device's own Shot chart setting, not the demo's.)
  await seedDemoData(page, { keepSettings: true });
  await openTracking(page, demoGameId(10));
  await expect(page.getByText('Finished game', { exact: true })).toBeVisible();
  await tapStat(page, 'Foul');
  await expect(stats(page).getByText('Fouls: 4 (foul trouble)')).toBeAttached();
  await expectAllSaved(page);
}

/** Mid-game, the shot just tapped: the court is outlined and the line says to tap it. */
async function spotToMark(page: Page) {
  await midGame(page);
  await tapStat(page, '3PT Miss');
  await expect(lastAction(page)).toContainText('Tap the court to mark the spot');
}

/** Mid-game, a shot's spot just marked: the pick and its value, and "Spot marked". */
async function spotMarked(page: Page) {
  await spotToMark(page);
  await tapCourt(page, { x: 19, y: 14.5 });
  await expect(lastAction(page)).toContainText('Spot marked');
  await expectAllSaved(page);
}

interface Shot {
  name: string;
  device: Device;
  /** The Shot chart setting: on (the default) shows the court. */
  shotChart?: boolean;
  capture: (page: Page) => Promise<void>;
}

const shots: Shot[] = [
  { name: 'fresh', device: IPHONE, capture: freshGame },
  { name: 'mid-game', device: IPHONE, capture: midGame },
  { name: 'mid-game-se', device: IPHONE_SE, capture: midGame },
  { name: 'mid-game-pro-max', device: IPHONE_PRO_MAX, capture: midGame },
  { name: 'mid-game-no-court', device: IPHONE, shotChart: false, capture: midGame },
  { name: 'mid-game-se-no-court', device: IPHONE_SE, shotChart: false, capture: midGame },
  {
    name: 'mid-game-pro-max-no-court',
    device: IPHONE_PRO_MAX,
    shotChart: false,
    capture: midGame,
  },
  { name: 'spot-to-mark', device: IPHONE, capture: spotToMark },
  { name: 'spot-marked', device: IPHONE, capture: spotMarked },
  { name: 'spot-marked-se', device: IPHONE_SE, capture: spotMarked },
  { name: 'spot-marked-pro-max', device: IPHONE_PRO_MAX, capture: spotMarked },
  {
    name: 'spot-beyond-arc',
    device: IPHONE,
    capture: async (page) => {
      await midGame(page);
      await tapStat(page, '2PT Made');
      await tapCourt(page, { x: -17, y: 17 });
      await expect(lastAction(page)).toContainText('Spot marked · beyond the arc');
    },
  },
  {
    name: 'court-hint',
    device: IPHONE,
    capture: async (page) => {
      await midGame(page);
      // The last stat was a foul: no shot to mark.
      await tapCourt(page, { x: 3, y: 12 });
      await expect(page.getByText('Tap 2PT or 3PT first')).toBeVisible();
    },
  },
  {
    name: 'not-saved',
    device: IPHONE,
    capture: async (page) => {
      await midGame(page);
      // The database keeps failing: two taps wait on screen to be saved.
      await failNextSaves(page, 1000);
      for (const name of ['Steal', 'Assist']) await tapStat(page, name);
      await expect(notSaved(page)).toContainText('2 stats not saved');
      await expect(notSaved(page)).toContainText('kept on this phone');
    },
  },
  { name: 'read-failed', device: IPHONE, capture: readFailed },
  { name: 'read-failed-se', device: IPHONE_SE, capture: readFailed },
  { name: 'undo-failed-se', device: IPHONE_SE, capture: undoFailed },
  { name: 'undo-failed-se-no-court', device: IPHONE_SE, shotChart: false, capture: undoFailed },
  {
    name: 'not-saved-se',
    device: IPHONE_SE,
    capture: async (page) => {
      await midGame(page);
      // A shot that can't be saved keeps its spot with it, on the phone.
      await failNextSaves(page, 1000);
      await tapStat(page, '2PT Miss');
      await tapCourt(page, { x: 5, y: 16 });
      await expect(notSaved(page)).toContainText('2PT Miss not saved');
      await expect(lastAction(page)).toContainText('Spot marked');
    },
  },
  {
    name: 'log',
    device: IPHONE,
    capture: async (page) => {
      await midGame(page);
      await page.getByRole('button', { name: 'Log' }).tap();
      await expect(page.getByRole('dialog', { name: 'Stat log' })).toBeVisible();
    },
  },
  {
    name: 'end-game',
    device: IPHONE,
    capture: async (page) => {
      await midGame(page);
      await page.getByRole('button', { name: 'End game' }).tap();
      const sheet = page.getByRole('dialog', { name: 'Final score' });
      await expect(sheet).toBeVisible();
      await sheet.getByLabel('Our team').fill('46');
      await sheet.getByLabel('Opponent').fill('39');
      await sheet.getByRole('heading', { name: 'Final score' }).focus();
    },
  },
  {
    name: 'end-game-not-saved',
    device: IPHONE_SE,
    capture: async (page) => {
      await midGame(page);
      await failNextSaves(page, 1000);
      await tapStat(page, 'Steal');
      await expect(notSaved(page)).toContainText('Steal not saved');
      await page.getByRole('button', { name: 'End game' }).tap();
      const sheet = page.getByRole('dialog', { name: 'Final score' });
      await sheet.getByLabel('Our team').fill('46');
      await sheet.getByLabel('Opponent').fill('39');
      await sheet.getByRole('button', { name: 'End game' }).tap();
      await expect(sheet.getByRole('button', { name: 'End anyway' })).toBeEnabled();
      await sheet.getByRole('heading', { name: 'Final score' }).focus();
    },
  },
  { name: 'finished', device: IPHONE, capture: finishedGame },
  { name: 'finished-se', device: IPHONE_SE, capture: finishedGame },
  { name: 'finished-se-no-court', device: IPHONE_SE, shotChart: false, capture: finishedGame },
  {
    name: 'done-not-saved',
    device: IPHONE,
    capture: async (page) => {
      await finishedGame(page);
      await failNextSaves(page, 1000);
      await tapStat(page, 'Turnover');
      await expect(notSaved(page)).toContainText('Turnover not saved');
      await page.getByRole('button', { name: 'Done' }).tap();
      const sheet = page.getByRole('dialog', { name: "1 stat isn't saved yet" });
      await expect(sheet.getByRole('button', { name: 'Done anyway' })).toBeEnabled();
    },
  },
];

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`live game, ${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    for (const shot of shots) {
      test(shot.name, async ({ page }) => {
        await emulateDevice(page, shot.device);
        await setShotChart(page, shot.shotChart ?? true);
        await shot.capture(page);
        // (By the DOM: an open sheet hides the page, court and all, from role queries.)
        await expect(page.locator('main svg[aria-label^="Shot spot"]')).toHaveCount(
          shot.shotChart === false ? 0 : 1,
        );
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${outputDir}/track-game-${shot.name}-${colorScheme}.png`,
          animations: 'disabled',
        });
      });
    }
  });
}
