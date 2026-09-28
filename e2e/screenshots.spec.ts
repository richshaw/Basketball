import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute } from './support/app';
import { demoGameId, seedDemoData } from './support/data';

interface Screen {
  /** File name stem: saved as `<name>-light.png` and `<name>-dark.png`. */
  name: string;
  /** Route to capture (build it with `paths.*`). */
  path: string;
  /** Optional preparation (e.g. create a game) after the app loads, before navigating. */
  setup?: (page: Page) => Promise<void>;
  /** Optional interaction once the screen shows (e.g. open a sheet), before the capture. */
  interact?: (page: Page) => Promise<void>;
  /** Capture just the screen, not the full page: for sheets and toasts over long pages. */
  viewportOnly?: boolean;
}

/** Taps a button and waits for the sheet or dialog it opens. */
function openDialog(buttonName: string, role: 'dialog' | 'alertdialog', dialogName: string) {
  return async (page: Page) => {
    await page.getByRole('button', { name: buttonName, exact: true }).tap();
    await expect(page.getByRole(role, { name: dialogName })).toBeVisible();
  };
}

// One line per screen. Later PRs: add your screens here.
const screens: Screen[] = [
  { name: 'games', path: paths.home },
  { name: 'stats', path: paths.stats },
  { name: 'settings', path: paths.settings },
  { name: 'new-game', path: paths.newGame },
  {
    name: 'game-report',
    path: paths.gameReport(demoGameId(10)),
    setup: seedDemoData,
    // The loading state has a title too, so wait for the report itself.
    interact: (page) =>
      expect(page.getByRole('heading', { level: 2, name: 'Play-by-play' })).toBeVisible(),
  },
  { name: 'track-game', path: paths.trackGame('demo') },
  { name: 'restore-backup', path: paths.restoreBackup() },
  // The shared component gallery, and its overlays one at a time.
  { name: 'dev-ui', path: paths.devUi },
  {
    name: 'dev-ui-sheet',
    path: paths.devUi,
    viewportOnly: true,
    interact: openDialog('Edit game', 'dialog', 'Edit game'),
  },
  {
    name: 'dev-ui-sheet-scrolling',
    path: paths.devUi,
    viewportOnly: true,
    interact: openDialog('Pick opponent', 'dialog', 'Pick opponent'),
  },
  {
    name: 'dev-ui-confirm',
    path: paths.devUi,
    viewportOnly: true,
    interact: openDialog('Delete game', 'alertdialog', 'Delete this game?'),
  },
  {
    name: 'dev-ui-toast',
    path: paths.devUi,
    viewportOnly: true,
    interact: async (page) => {
      await page.getByRole('button', { name: '2PT made' }).tap();
      await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    },
  },
  {
    name: 'dev-ui-toast-top',
    path: paths.devUi,
    viewportOnly: true,
    interact: async (page) => {
      await page.getByRole('button', { name: 'Top toast' }).tap();
      await expect(page.getByRole('status', { name: 'Notifications' })).toHaveText('Saved');
    },
  },
  {
    name: 'dev-ui-sheet-toast',
    path: paths.devUi,
    viewportOnly: true,
    interact: async (page) => {
      await openDialog('Pick opponent', 'dialog', 'Pick opponent')(page);
      await page.getByRole('button', { name: 'Copy list' }).tap();
      await expect(page.getByRole('status', { name: 'Notifications' })).toContainText('Copied');
    },
  },
];

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    for (const screen of screens) {
      test(screen.name, async ({ page }) => {
        await emulateIPhoneSafeArea(page);
        await page.goto('./');
        await screen.setup?.(page);
        // Open the screen in a fresh document: after a same-page hash change, the previous
        // screen's heading could still be on show and get captured instead.
        await page.goto('about:blank');
        await page.goto(appUrl(screen.path));
        await expectRoute(page, screen.path);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
        // Screens that read data mark it aria-busy until it's in (e.g. Stats): wait for it.
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        await screen.interact?.(page);

        await page.screenshot({
          path: `${outputDir}/${screen.name}-${colorScheme}.png`,
          fullPage: !screen.viewportOnly,
          animations: 'disabled',
        });
      });
    }
  });
}
