import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';

const tabScreens = [
  { path: paths.home, title: 'Games' },
  { path: paths.stats, title: 'Stats' },
  { path: paths.settings, title: 'Settings' },
];
const fullScreens = [
  { path: paths.newGame, title: 'New game' },
  { path: paths.gameReport('g1'), title: 'Game report' },
  { path: paths.trackGame('g1'), title: 'Live game' },
  { path: paths.devUi, title: 'UI kit' },
];

const tabBar = () => screen.queryByRole('navigation', { name: 'Main' });
const updateBanner = () => screen.queryByRole('complementary', { name: 'App update' });

describe('app routes', () => {
  it.each([...tabScreens, ...fullScreens])(
    'renders the $title screen at $path',
    async ({ path, title }) => {
      renderRoute(path);
      // Screens that load a game from the database show their heading once it has loaded.
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    },
  );

  it.each(tabScreens)('shows the tab bar on $title', ({ path }) => {
    renderRoute(path);
    expect(tabBar()).toBeInTheDocument();
  });

  it.each(fullScreens)('hides the tab bar on the full-screen $title route', ({ path }) => {
    renderRoute(path);
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

  it.each(fullScreens)('never shows the update banner on $title', ({ path }) => {
    renderRoute(path, { serviceWorker: { needRefresh: true } });
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
    const { user, router } = renderRoute(paths.gameReport('g 1'));
    await user.click(screen.getByRole('link', { name: 'Track game' }));
    expect(router.state.location.pathname).toBe(paths.trackGame('g 1'));

    await user.click(await screen.findByRole('link', { name: 'Games' }));
    expect(router.state.location.pathname).toBe(paths.home);
  });
});
