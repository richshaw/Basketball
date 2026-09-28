import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '@/data/repo';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import { INSTALL_BANNER_SNOOZE_MS } from './install';
import { DESKTOP_CHROME_UA, restoreStubs, simulateBrowser } from '@/test/browser';

const banner = () => screen.queryByRole('complementary', { name: 'Add to Home Screen' });

afterEach(() => {
  restoreStubs();
  localStorage.clear();
});

describe('InstallBanner', () => {
  it.each([
    ['Games', paths.home],
    ['Stats', paths.stats],
    ['Settings', paths.settings],
  ])('shows on the %s tab in iPhone Safari', (_, path) => {
    simulateBrowser();
    renderRoute(path);
    expect(banner()).toHaveTextContent(
      'Add Hoop Stats to your Home Screen so it works offline and your stats stay safe.',
    );
  });

  it('never shows on the live game screen or other full-screen routes', () => {
    simulateBrowser();
    for (const path of [paths.trackGame('g1'), paths.newGame, paths.gameReport('g1')]) {
      const { unmount } = renderRoute(path);
      expect(banner()).not.toBeInTheDocument();
      unmount();
    }
  });

  it('never shows in the Home Screen app', () => {
    simulateBrowser({ navigatorStandalone: true });
    const { unmount } = renderRoute(paths.home);
    expect(banner()).not.toBeInTheDocument();
    unmount();
    restoreStubs();

    simulateBrowser({ displayModeStandalone: true });
    renderRoute(paths.home);
    expect(banner()).not.toBeInTheDocument();
  });

  it('never shows in desktop browsers (or these tests)', () => {
    renderRoute(paths.home);
    expect(banner()).not.toBeInTheDocument();

    simulateBrowser({ userAgent: DESKTOP_CHROME_UA, maxTouchPoints: 0 });
    renderRoute(paths.stats);
    expect(banner()).not.toBeInTheDocument();
  });

  it('opens the steps from How', async () => {
    simulateBrowser();
    await createGame({ opponent: 'Lincoln', date: '2026-09-26', periodFormat: 'quarters' });
    const { user } = renderRoute(paths.home);

    await user.click(within(banner() as HTMLElement).getByRole('button', { name: 'How' }));

    const sheet = screen.getByRole('dialog', { name: 'Add to Home Screen' });
    expect(within(sheet).getByRole('list', { name: 'In Safari' })).toHaveTextContent(
      'Tap the Share button',
    );
    // Safari's data doesn't carry over, so this game needs a backup file to move.
    await waitFor(() => {
      expect(sheet).toHaveTextContent(
        'To move the game recorded here, save a backup file in Settings, then restore it in the app.',
      );
    });
    // iPhone steps only: no note for other devices.
    expect(sheet).not.toHaveTextContent('Not on an iPhone?');
    // The banner stays until it's dismissed.
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(banner()).toBeInTheDocument();
  });

  it('stays dismissed for 14 days', async () => {
    const now = new Date(2026, 8, 28, 12).getTime();
    vi.useFakeTimers({ toFake: ['Date'], now });
    simulateBrowser();
    const { user, unmount } = renderRoute(paths.home);

    await user.click(within(banner() as HTMLElement).getByRole('button', { name: 'Dismiss' }));
    expect(banner()).not.toBeInTheDocument();
    unmount();

    // Relaunched later: still away...
    vi.setSystemTime(now + INSTALL_BANNER_SNOOZE_MS - 60_000);
    const later = renderRoute(paths.home);
    expect(banner()).not.toBeInTheDocument();
    later.unmount();

    // ...until two weeks have passed.
    vi.setSystemTime(now + INSTALL_BANNER_SNOOZE_MS);
    renderRoute(paths.home);
    expect(banner()).toBeInTheDocument();
  });
});
