import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { paths } from '@/routes';
import { renderWithRouter } from '@/test/render';
import { TabBar } from './TabBar';

function tab(name: string) {
  return within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name });
}

describe('TabBar', () => {
  it('links to the three tab screens', () => {
    renderWithRouter(<TabBar />);
    expect(tab('Games')).toHaveAttribute('href', paths.home);
    expect(tab('Stats')).toHaveAttribute('href', paths.stats);
    expect(tab('Settings')).toHaveAttribute('href', paths.settings);
  });

  it('marks only the current tab as active', () => {
    renderWithRouter(<TabBar />, { path: paths.stats });
    expect(tab('Stats')).toHaveAttribute('aria-current', 'page');
    expect(tab('Stats')).toHaveClass('active');
    expect(tab('Games')).not.toHaveAttribute('aria-current');
    expect(tab('Settings')).not.toHaveAttribute('aria-current');
  });

  it('keeps Games active only on its own path', () => {
    renderWithRouter(<TabBar />, { path: paths.home });
    expect(tab('Games')).toHaveAttribute('aria-current', 'page');
  });

  it('moves the active state when another tab is tapped', async () => {
    const { user, router } = renderWithRouter(<TabBar />);
    await user.click(tab('Settings'));
    expect(router.state.location.pathname).toBe(paths.settings);
    expect(tab('Settings')).toHaveAttribute('aria-current', 'page');
    expect(tab('Games')).not.toHaveAttribute('aria-current');
  });
});
