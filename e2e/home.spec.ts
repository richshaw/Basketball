import { expect, test } from '@playwright/test';
import { paths } from '../src/routes';
import {
  emulateIPhoneSafeArea,
  expectRoute,
  IPHONE_SAFE_BOTTOM,
  IPHONE_VIEWPORT,
  screenHeading,
} from './support/app';
import { DEMO_LIVE_GAME_ID, demoGameId, seedDemoData } from './support/data';

const TRACK_URL = /#\/games\/[^/]+\/track$/;

test('first run: name the player, start a game, and get back to it from Games', async ({
  page,
}) => {
  await emulateIPhoneSafeArea(page);
  await page.goto('./');
  await expect(screenHeading(page, 'Games')).toBeVisible();

  const setup = page.getByRole('region', { name: 'Who are you tracking?' });
  await setup.getByLabel('Name', { exact: true }).fill('Ava');
  await setup.getByLabel('Number').fill('12');
  await setup.getByRole('button', { name: 'Save' }).tap();
  await expect(setup).toHaveCount(0);
  await expect(page.getByText('Ava · #12')).toBeVisible();

  await page.getByRole('link', { name: 'New game' }).tap();
  await expectRoute(page, paths.newGame);
  // The whole form fits on the phone: Start shows above the home indicator, no scrolling.
  const start = page.getByRole('button', { name: 'Start game' });
  const box = await start.boundingBox();
  expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThanOrEqual(
    IPHONE_VIEWPORT.height - IPHONE_SAFE_BOTTOM,
  );

  await page.getByLabel('Opponent').fill('Central');
  await page.getByRole('radio', { name: 'Away' }).tap();
  await start.tap();
  await expect(page).toHaveURL(TRACK_URL);
  const trackUrl = page.url();

  // Start game took the form's place in the history: Back lands on Games (the app's
  // first page, opened at `./` like the installed app, so its URL has no `#/` yet).
  await page.goBack();
  await expect(page).toHaveURL((url) => url.hash === '' || url.hash === `#${paths.home}`);
  await expect(screenHeading(page, 'Games')).toBeVisible();
  const liveGame = page.getByRole('region', { name: 'Game in progress' });
  await expect(liveGame).toContainText('@ Central');
  await expect(liveGame).toContainText('Q1');
  await expect(liveGame).toBeInViewport();

  await liveGame.getByRole('link', { name: 'Resume game' }).tap();
  await expect(page).toHaveURL(trackUrl);
});

test('the list opens a finished game’s report, or resumes the live game', async ({ page }) => {
  await page.goto('./');
  await seedDemoData(page, { liveGame: true });

  const games = page.getByRole('list', { name: 'Fall 2026' }).getByRole('link');
  await expect(games).toHaveCount(11);
  await expect(games.first()).toContainText('Live');

  await games.nth(1).tap();
  await expectRoute(page, paths.gameReport(demoGameId(10)));

  await page.goBack();
  await games.first().tap();
  await expectRoute(page, paths.trackGame(DEMO_LIVE_GAME_ID));
});
