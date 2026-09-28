import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, expectRoute, IPHONE_SAFE_BOTTOM, IPHONE_VIEWPORT } from './support/app';
import { DEMO_LIVE_GAME_ID, demoGameId, seedDemoData } from './support/data';

// Screenshots of the live game screen in its main states, at the typical iPhone size
// and the smallest and largest ones. Run with `npm run screenshots` (SCREENSHOT_DIR
// picks the folder).

interface Device {
  width: number;
  height: number;
  /** Home indicator inset; 0 on phones with a home button. */
  safeBottom: number;
}

const IPHONE: Device = { ...IPHONE_VIEWPORT, safeBottom: IPHONE_SAFE_BOTTOM };
const IPHONE_SE: Device = { width: 375, height: 667, safeBottom: 0 };
const IPHONE_PRO_MAX: Device = { width: 430, height: 932, safeBottom: IPHONE_SAFE_BOTTOM };

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

const lastAction = (page: Page) => page.getByRole('status', { name: 'Last action' });
const stats = (page: Page) => page.getByRole('list', { name: 'Game stats' });

async function openTracking(page: Page, gameId: string) {
  await page.goto('about:blank');
  await page.goto(appUrl(paths.trackGame(gameId)));
  await expectRoute(page, paths.trackGame(gameId));
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
}

/** The demo live game with all of its stats undone, back in Q1: a game just started. */
async function freshGame(page: Page) {
  await page.goto('./');
  await seedDemoData(page, { liveGame: true });
  await openTracking(page, DEMO_LIVE_GAME_ID);
  // Undo far more times than the demo game has stats; each tap removes the latest one.
  await page
    .getByRole('button', { name: 'Undo last stat' })
    .evaluate((undo: HTMLElement) => Array.from({ length: 80 }, () => undo.click()));
  await expect(lastAction(page)).toHaveText('Nothing to undo');
  await expect(stats(page).getByText('Points: 0')).toBeAttached();
  await page.getByRole('button', { name: /^Period / }).tap();
  await page.getByRole('dialog', { name: 'Period' }).getByRole('button', { name: 'Q1' }).tap();
  await expect(page.getByRole('button', { name: 'Period Q1' })).toBeVisible();
  // Reopen, so the screen looks exactly as it does for a brand-new game.
  await openTracking(page, DEMO_LIVE_GAME_ID);
  await expect(lastAction(page)).toHaveText('Tap a button to record a stat');
}

async function midGame(page: Page) {
  await freshGame(page);
  for (const tap of GAME_TAPS) {
    if (tap === NEXT_PERIOD) {
      await page.getByRole('button', { name: 'Next period' }).tap();
    } else {
      await page
        .getByRole('group', { name: 'Record a stat' })
        .getByRole('button', { name: tap })
        .tap();
    }
  }
  await expect(stats(page).getByText('Points: 14')).toBeAttached();
  await expect(lastAction(page)).toContainText('Foul · Q3');
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
    name: 'finished',
    device: IPHONE,
    capture: async (page) => {
      await page.goto('./');
      await seedDemoData(page);
      await openTracking(page, demoGameId(10));
      await expect(page.getByText('Editing a finished game')).toBeVisible();
      // A correction: one more foul puts her in foul trouble (4).
      await page
        .getByRole('group', { name: 'Record a stat' })
        .getByRole('button', { name: 'Foul' })
        .tap();
      await expect(stats(page).getByText('Fouls: 4 (foul trouble)')).toBeAttached();
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
