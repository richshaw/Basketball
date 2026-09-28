import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute, screenHeading } from './support/app';
import { DEMO_LIVE_GAME_ID, demoGameId, seedDemoData } from './support/data';

// Screenshots of the game report in its main states (`npm run screenshots`), like
// e2e/screenshots.spec.ts but with demo data and a wait for the loaded report.

interface Screen {
  /** File name stem: saved as `<name>-light.png` and `<name>-dark.png`. */
  name: string;
  gameId: string;
  /** The screen title once the game has loaded. */
  title: string;
  /** Optional interaction once the report shows, before the capture. */
  interact?: (page: Page) => Promise<void>;
  /** Capture just the screen, not the full page: for sheets over the long report. */
  viewportOnly?: boolean;
}

/** Fixed, so the demo dates (counted back from "today") are the same in every run. */
const DEMO_TODAY = '2026-09-28';

async function openEditSheet(page: Page) {
  await page.getByRole('button', { name: 'Edit details' }).tap();
  await expect(page.getByRole('dialog', { name: 'Edit game' })).toBeVisible();
}

/** Scrolls the heading of the report section `name` to just under the sticky screen header. */
async function scrollToSection(page: Page, name: string) {
  await page.getByRole('heading', { level: 2, name }).evaluate((heading) => {
    const headerHeight = document.querySelector('header')?.offsetHeight ?? 0;
    const top = heading.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
    window.scrollTo(0, top);
  });
}

const screens: Screen[] = [
  { name: 'game-report-win', gameId: demoGameId(10), title: 'vs Eastlake' },
  { name: 'game-report-loss', gameId: demoGameId(9), title: '@ Riverside' },
  { name: 'game-report-live', gameId: DEMO_LIVE_GAME_ID, title: 'vs Westfield' },
  {
    // Every demo game is long enough to start with its quarters closed: open one.
    name: 'game-report-plays',
    gameId: demoGameId(10),
    title: 'vs Eastlake',
    viewportOnly: true,
    interact: async (page) => {
      const firstQuarter = page.getByRole('button', { name: /^1st quarter, / });
      await firstQuarter.tap();
      await expect(firstQuarter).toHaveAttribute('aria-expanded', 'true');
      await scrollToSection(page, 'Play-by-play');
    },
  },
  {
    // The shot chart at full size: the court, its legend and the zone tiles.
    name: 'game-report-shot-chart',
    gameId: demoGameId(10),
    title: 'vs Eastlake',
    viewportOnly: true,
    interact: (page) => scrollToSection(page, 'Shot chart'),
  },
  {
    name: 'game-report-edit',
    gameId: demoGameId(10),
    title: 'vs Eastlake',
    viewportOnly: true,
    interact: openEditSheet,
  },
  {
    // Also the one with notes.
    name: 'game-report-no-score',
    gameId: demoGameId(8),
    title: 'vs Northside',
    interact: async (page) => {
      await openEditSheet(page);
      const sheet = page.getByRole('dialog', { name: 'Edit game' });
      await sheet.getByLabel('Our score').fill('');
      await sheet.getByLabel('Their score').fill('');
      await sheet.getByRole('button', { name: 'Save' }).tap();
      await expect(sheet).toBeHidden();
      await expect(page.getByText('No score entered')).toBeVisible();
      // Let the "Changes saved" toast go, so it doesn't cover the report.
      await expect(page.getByRole('status', { name: 'Notifications' })).toBeEmpty({
        timeout: 10_000,
      });
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
        await seedDemoData(page, { today: DEMO_TODAY, liveGame: true });
        // A fresh document, as in e2e/screenshots.spec.ts.
        await page.goto('about:blank');
        const path = paths.gameReport(screen.gameId);
        await page.goto(appUrl(path));
        await expectRoute(page, path);
        await expect(screenHeading(page, screen.title)).toBeVisible();
        await expect(page.getByRole('heading', { level: 2, name: 'Play-by-play' })).toBeVisible();
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
