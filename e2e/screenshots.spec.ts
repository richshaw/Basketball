import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea } from './support/app';

interface Screen {
  /** File name stem: saved as `<name>-light.png` and `<name>-dark.png`. */
  name: string;
  /** Route to capture (build it with `paths.*`). */
  path: string;
  /** Optional preparation (e.g. create a game) after the app loads, before navigating. */
  setup?: (page: Page) => Promise<void>;
}

// One line per screen. Later PRs: add your screens here.
const screens: Screen[] = [
  { name: 'games', path: paths.home },
  { name: 'stats', path: paths.stats },
  { name: 'settings', path: paths.settings },
  { name: 'new-game', path: paths.newGame },
  { name: 'game-report', path: paths.gameReport('demo') },
  { name: 'track-game', path: paths.trackGame('demo') },
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
        await page.goto(appUrl(screen.path));
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);

        await page.screenshot({
          path: `${outputDir}/${screen.name}-${colorScheme}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      });
    }
  });
}
