import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, expectRoute, IPHONE_SAFE_BOTTOM, IPHONE_VIEWPORT } from './support/app';
import { demoGameId, seedDemoData } from './support/data';
import {
  expectAllSaved,
  failNextSaves,
  failStatReads,
  lastAction,
  notSaved,
  readFailedNote,
  startGame,
  stats,
} from './support/tracking';

// Screenshots of the live game screen in its main states, at the typical iPhone size
// and the smallest and largest ones (as installed apps: the status bar is above the
// page). Run with `npm run screenshots` (SCREENSHOT_DIR picks the folder).

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

/** A realistic first three quarters, as the parent would tap it: stat buttons and Next. */
const GAME_TAPS: readonly string[] = [
  '2PT Made',
  'Def Reb',
  'Assist',
  '2PT Miss',
  'Off Reb',
  '2PT Made',
  'Foul',
  'FT Made',
  'FT Miss',
  'Steal',
  NEXT_PERIOD,
  '3PT Made',
  'Turnover',
  'Def Reb',
  '2PT Miss',
  'Block',
  'Deflection',
  'Foul',
  'Assist',
  'FT Made',
  'FT Made',
  NEXT_PERIOD,
  '2PT Made',
  'Def Reb',
  '3PT Miss',
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

/** A game just started from the New game form. */
async function freshGame(page: Page) {
  await startGame(page);
  await expect(lastAction(page)).toHaveText('Tap a button to record a stat');
}

async function midGame(page: Page) {
  await startGame(page);
  for (const tap of GAME_TAPS) {
    if (tap === NEXT_PERIOD) {
      // Clear of the double-tap guard on Next.
      await page.waitForTimeout(450);
      await page.getByRole('button', { name: 'Next period' }).tap();
    } else {
      await page
        .getByRole('group', { name: 'Record a stat' })
        .getByRole('button', { name: tap, exact: true })
        .tap();
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

/** A finished game being corrected: one more foul puts her in foul trouble (4). */
async function finishedGame(page: Page) {
  await page.goto('./');
  await seedDemoData(page);
  await openTracking(page, demoGameId(10));
  await expect(page.getByText('Editing a finished game')).toBeVisible();
  await page
    .getByRole('group', { name: 'Record a stat' })
    .getByRole('button', { name: 'Foul' })
    .tap();
  await expect(stats(page).getByText('Fouls: 4 (foul trouble)')).toBeAttached();
  await expectAllSaved(page);
}

interface Shot {
  name: string;
  device: Device;
  capture: (page: Page) => Promise<void>;
}

const shots: Shot[] = [
  { name: 'fresh', device: IPHONE, capture: freshGame },
  { name: 'mid-game', device: IPHONE, capture: midGame },
  { name: 'mid-game-se', device: IPHONE_SE, capture: midGame },
  { name: 'mid-game-pro-max', device: IPHONE_PRO_MAX, capture: midGame },
  {
    name: 'not-saved',
    device: IPHONE,
    capture: async (page) => {
      await midGame(page);
      // The database keeps failing: two taps wait on screen to be saved.
      await failNextSaves(page, 1000);
      for (const name of ['Steal', 'Assist']) {
        await page
          .getByRole('group', { name: 'Record a stat' })
          .getByRole('button', { name })
          .tap();
      }
      await expect(notSaved(page)).toContainText('2 stats not saved');
      await expect(notSaved(page)).toContainText('kept on this phone');
    },
  },
  { name: 'read-failed', device: IPHONE, capture: readFailed },
  { name: 'read-failed-se', device: IPHONE_SE, capture: readFailed },
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
      await page
        .getByRole('group', { name: 'Record a stat' })
        .getByRole('button', { name: 'Steal' })
        .tap();
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
  {
    name: 'done-not-saved',
    device: IPHONE,
    capture: async (page) => {
      await finishedGame(page);
      await failNextSaves(page, 1000);
      await page
        .getByRole('group', { name: 'Record a stat' })
        .getByRole('button', { name: 'Turnover' })
        .tap();
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
        await shot.capture(page);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `${outputDir}/track-game-${shot.name}-${colorScheme}.png`,
          animations: 'disabled',
        });
      });
    }
  });
}
