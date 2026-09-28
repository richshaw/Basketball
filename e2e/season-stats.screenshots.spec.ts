import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute } from './support/app';
import { seedDemoData } from './support/data';

// Screenshots of the Stats screen (mirrors e2e/screenshots.spec.ts). The demo season is
// seeded from a fixed date so the pictures only change when the screen does.

interface Shot {
  /** File name stem: saved as `<name>-light.png` and `<name>-dark.png`. */
  name: string;
  /** Preparation after the app loads, before the Stats screen opens (e.g. seed data). */
  setup?: (page: Page) => Promise<void>;
  /** Interaction once the screen shows, before the capture. */
  interact?: (page: Page) => Promise<void>;
  /** Capture just the screen, not the full page. */
  viewportOnly?: boolean;
}

const DEMO_TODAY = '2026-09-28';
const seedSeason = (page: Page) => seedDemoData(page, { today: DEMO_TODAY });

/** Scrolls the chart named `name` to the middle of the screen. */
async function centerOnScreen(page: Page, name: string) {
  const chart = page.getByRole('group', { name });
  await chart.evaluate((element) => element.scrollIntoView({ block: 'center' }));
}

const shots: Shot[] = [
  { name: 'season-stats-top', setup: seedSeason, viewportOnly: true },
  { name: 'season-stats-full', setup: seedSeason },
  {
    name: 'season-stats-chart',
    setup: seedSeason,
    viewportOnly: true,
    interact: (page) => centerOnScreen(page, 'Points by game'),
  },
  {
    name: 'season-stats-chart-selected',
    setup: seedSeason,
    viewportOnly: true,
    interact: async (page) => {
      await page.getByRole('radio', { name: 'Rebounds' }).tap();
      await centerOnScreen(page, 'Rebounds by game');
      await page.getByRole('button', { name: /Northside/ }).tap();
      await expect(page.getByRole('link', { name: /Game report, vs Northside/ })).toBeVisible();
    },
  },
  {
    name: 'season-stats-live-game',
    setup: (page) => seedDemoData(page, { today: DEMO_TODAY, liveGame: true }),
    viewportOnly: true,
  },
  { name: 'season-stats-empty' },
];

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`Stats screen, ${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    for (const shot of shots) {
      test(shot.name, async ({ page }) => {
        await emulateIPhoneSafeArea(page);
        await page.goto('./');
        await shot.setup?.(page);
        // A fresh document, so the previous screen can't be what gets captured.
        await page.goto('about:blank');
        await page.goto(appUrl(paths.stats));
        await expectRoute(page, paths.stats);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
        // Wait for the data to load: the stats or the empty state.
        await expect(
          page.getByRole('heading', { level: 2, name: /Averages|No stats yet/ }),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await shot.interact?.(page);

        await page.screenshot({
          path: `${outputDir}/${shot.name}-${colorScheme}.png`,
          fullPage: !shot.viewportOnly,
          animations: 'disabled',
        });
      });
    }
  });
}
