import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute, screenHeading } from './support/app';
import { seedDemoData } from './support/data';

// Screenshots of the Games tab and the New game form in their main states
// (`npm run screenshots`). Same conventions as screenshots.spec.ts, which already
// captures both screens on a fresh app (`games`: the first run, `new-game`: the
// empty form), so those states aren't repeated here.

interface Screen {
  /** File name stem: saved as `<name>-light.png` and `<name>-dark.png`. */
  name: string;
  /** Route to capture (build it with `paths.*`). */
  path: string;
  /** Optional preparation (e.g. seed data) after the app loads, before navigating. */
  setup?: (page: Page) => Promise<void>;
  /** Optional interaction once the screen shows (e.g. fill the form), before the capture. */
  interact?: (page: Page) => Promise<void>;
  /** Capture just the screen, not the full page. */
  viewportOnly?: boolean;
}

const TRACK_URL = /#\/games\/[^/]+\/track$/;

/** First run on Games: name the player. */
async function setUpPlayer(page: Page) {
  const setup = page.getByRole('region', { name: 'Who are you tracking?' });
  await setup.getByLabel('Name', { exact: true }).fill('Ava');
  await setup.getByLabel('Number').fill('12');
  await setup.getByRole('button', { name: 'Save' }).tap();
  await expect(setup).toHaveCount(0);
}

/** Starts a game through the form. */
async function startGame(page: Page, opponent: string, season?: string) {
  await page.goto(appUrl(paths.newGame));
  await page.getByLabel('Opponent').fill(opponent);
  if (season) await page.getByLabel('Season or team').fill(season);
  await page.getByRole('button', { name: 'Start game' }).tap();
  await expect(page).toHaveURL(TRACK_URL);
}

/** The demo season, plus a live game in another season. */
async function startWinterGame(page: Page) {
  await seedDemoData(page);
  await startGame(page, 'Central', 'Winter 2027');
}

async function fillNewGame(page: Page) {
  await page.getByLabel('Opponent').fill('Westview');
  await page.getByRole('radio', { name: 'Away' }).tap();
}

async function tryToStartEmpty(page: Page) {
  await page.getByRole('button', { name: 'Start game' }).tap();
  await expect(page.getByText('Enter the other team’s name')).toBeVisible();
}

const screens: Screen[] = [
  { name: 'home-no-games', path: paths.home, setup: setUpPlayer },
  { name: 'home-games', path: paths.home, setup: (page) => seedDemoData(page) },
  {
    name: 'home-live-game',
    path: paths.home,
    setup: (page) => seedDemoData(page, { liveGame: true }),
  },
  {
    name: 'home-live-game-viewport',
    path: paths.home,
    viewportOnly: true,
    setup: (page) => seedDemoData(page, { liveGame: true }),
  },
  // A game started before the player was named: Resume stays the main action.
  {
    name: 'home-live-game-unnamed',
    path: paths.home,
    viewportOnly: true,
    setup: (page) => startGame(page, 'Central'),
  },
  { name: 'home-seasons', path: paths.home, setup: startWinterGame },
  {
    name: 'new-game-filled',
    path: paths.newGame,
    setup: (page) => seedDemoData(page),
    interact: fillNewGame,
  },
  {
    name: 'new-game-in-progress',
    path: paths.newGame,
    setup: (page) => seedDemoData(page, { liveGame: true }),
  },
  { name: 'new-game-invalid', path: paths.newGame, interact: tryToStartEmpty },
];

/**
 * Both screens hold their content back until its data is read, then mark anything
 * still loading (the Games list waits for every stat) `aria-busy`. Wait for all of it.
 */
async function waitForData(page: Page) {
  const newGameLink = page.getByRole('link', { name: 'New game' });
  const startButton = page.getByRole('button', { name: 'Start game' });
  await expect(newGameLink.or(startButton)).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    for (const screen of screens) {
      test(screen.name, async ({ page }) => {
        await emulateIPhoneSafeArea(page);
        await page.goto('./');
        await expect(screenHeading(page, 'Games')).toBeVisible();
        await screen.setup?.(page);
        // Open the screen in a fresh document: after a same-page hash change, the previous
        // screen's heading could still be on show and get captured instead.
        await page.goto('about:blank');
        await page.goto(appUrl(screen.path));
        await expectRoute(page, screen.path);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
        await waitForData(page);
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
