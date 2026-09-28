import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';

vi.mock('@/screens/SeasonStats/SeasonStatsScreen', () => ({
  SeasonStatsScreen: () => {
    throw new Error('Stats broke');
  },
}));
vi.mock('@/screens/TrackGame/TrackGameScreen', () => ({
  TrackGameScreen: () => {
    throw new Error('Tracking broke');
  },
}));

const errorHeading = () => screen.getByRole('heading', { name: 'Something went wrong' });
const tabBar = () => screen.queryByRole('navigation', { name: 'Main' });

describe('when a screen crashes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keeps the tab bar and update banner around a crashed tab screen', () => {
    renderRoute(paths.stats, { serviceWorker: { needRefresh: true } });

    expect(errorHeading()).toBeInTheDocument();
    expect(tabBar()).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'App update' })).toBeInTheDocument();
  });

  it('shows a full-screen error for other routes, with a way back to Games', async () => {
    const { user } = renderRoute(paths.trackGame('g1'));

    expect(errorHeading()).toBeInTheDocument();
    expect(tabBar()).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Go to Games' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
    expect(tabBar()).toBeInTheDocument();
  });
});
