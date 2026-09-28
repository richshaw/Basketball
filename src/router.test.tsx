import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEMO_LIVE_GAME_ID, seedDemoData } from '@/data/demo';
import { createGame } from '@/data/repo';
import { paths } from '@/routes';
import { renderRoute, type RenderRouteOptions } from '@/test/render';

const tabScreens = [
  { path: paths.home, title: 'Games' },
  { path: paths.stats, title: 'Stats' },
  { path: paths.settings, title: 'Settings' },
];
interface FullScreen {
  path: string;
  title: string;
  /** Data the screen needs, stored before it renders. */
  seed?: () => Promise<unknown>;
}
const fullScreens: FullScreen[] = [
  { path: paths.newGame, title: 'New game' },
  { path: paths.gameReport('g1'), title: 'Game report' },
  // The real live game screen, on the demo game (not its "Game not found" state).
  {
    path: paths.trackGame(DEMO_LIVE_GAME_ID),
    title: 'vs Westfield',
    seed: () => seedDemoData({ liveGame: true }),
  },
  { path: paths.devUi, title: 'UI kit' },
];

/** Stores the screen's data, renders it and waits for its title (see below). */
async function renderScreen({ path, title, seed }: FullScreen, options?: RenderRouteOptions) {
  await seed?.();
  const view = renderRoute(path, options);
  // findBy: screens that load a game from the database show their heading once it
  // has loaded, and some (the UI kit gallery) load on demand, slowly on a cold start.
  await screen.findByRole('heading', { level: 1, name: title }, { timeout: 5000 });
  return view;
}

const tabBar = () => screen.queryByRole('navigation', { name: 'Main' });
const updateBanner = () => screen.queryByRole('complementary', { name: 'App update' });

describe('app routes', () => {
  it.each<FullScreen>([...tabScreens, ...fullScreens])(
    'renders the $title screen at $path',
    async (screenToShow) => {
      await renderScreen(screenToShow);
      expect(screen.getByRole('heading', { level: 1, name: screenToShow.title })).toBeVisible();
    },
  );

  it.each(tabScreens)('shows the tab bar on $title', ({ path }) => {
    renderRoute(path);
    expect(tabBar()).toBeInTheDocument();
  });

  it.each(fullScreens)('hides the tab bar on the full-screen $title route', async (full) => {
    await renderScreen(full);
    expect(tabBar()).not.toBeInTheDocument();
  });

  it('redirects unknown paths to Games', () => {
    const { router } = renderRoute('/no/such/page');
    expect(router.state.location.pathname).toBe(paths.home);
    expect(screen.getByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
  });

  it.each(tabScreens)('shows a waiting update on $title', ({ path }) => {
    renderRoute(path, { serviceWorker: { needRefresh: true } });
    expect(updateBanner()).toBeInTheDocument();
  });

  it.each(fullScreens)('never shows the update banner on $title', async (full) => {
    await renderScreen(full, { serviceWorker: { needRefresh: true } });
    expect(updateBanner()).not.toBeInTheDocument();
  });

  it('goes from Games to a new game and back', async () => {
    const { user, router } = renderRoute(paths.home);
    await user.click(screen.getByRole('link', { name: 'New game' }));
    expect(router.state.location.pathname).toBe(paths.newGame);

    await user.click(screen.getByRole('link', { name: 'Games' }));
    expect(router.state.location.pathname).toBe(paths.home);
  });

  it('goes from a game report to live tracking, and from there back to Games', async () => {
    const game = await createGame({
      opponent: 'Lincoln',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const { user, router } = renderRoute(paths.gameReport(game.id));
    await user.click(await screen.findByRole('link', { name: 'Resume tracking' }));
    expect(router.state.location.pathname).toBe(paths.trackGame(game.id));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'vs Lincoln' }),
    ).toBeInTheDocument();

    // Leaving the live game screen never ends the game: its back link leads to Games.
    await user.click(screen.getByRole('link', { name: 'Games' }));
    expect(router.state.location.pathname).toBe(paths.home);
  });
});
