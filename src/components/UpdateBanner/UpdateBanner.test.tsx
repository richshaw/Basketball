import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { holdUnsavedTaps } from '@/data/pendingStats';
import {
  noServiceWorkerUpdate,
  ServiceWorkerContext,
  type ServiceWorkerUpdate,
} from '@/pwa/serviceWorkerContext';
import { UpdateBanner } from './UpdateBanner';

function renderBanner(state: Partial<ServiceWorkerUpdate>) {
  const user = userEvent.setup();
  render(
    <ServiceWorkerContext value={{ ...noServiceWorkerUpdate, ...state }}>
      <UpdateBanner />
    </ServiceWorkerContext>,
  );
  return { user };
}

/**
 * Taps a (fake) live game screen holds only in memory, until the test ends: a reload
 * would lose them until `keep()` (say, the app-wide retry saved them), and again after
 * `lose()`.
 */
function holdUnkeptTaps() {
  let safe = false;
  const listeners = new Set<() => void>();
  onTestFinished(
    holdUnsavedTaps({
      gameId: 'g1',
      hasUnsaved: () => !safe,
      reloadSafe: () => safe,
      retryQuietly: () => Promise.resolve(),
      saved: () => {},
      forget: () => () => {},
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    }),
  );
  const set = (value: boolean) => {
    safe = value;
    act(() => {
      for (const listener of [...listeners]) listener();
    });
  };
  return { keep: () => set(true), lose: () => set(false) };
}

const banner = () => screen.queryByRole('complementary', { name: 'App update' });

describe('UpdateBanner', () => {
  it('renders nothing while there is no new version', () => {
    renderBanner({ needRefresh: false });
    expect(screen.queryByRole('complementary', { name: 'App update' })).not.toBeInTheDocument();
  });

  it('offers the new version and updates when tapped', async () => {
    const update = vi.fn(() => Promise.resolve());
    const { user } = renderBanner({ needRefresh: true, update });

    expect(screen.getByRole('status')).toHaveTextContent('New version available');
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(update).toHaveBeenCalledTimes(1);
    // update() resolves once the switch has started; the page reloads right after
    // (see applyUpdate), so the banner keeps showing progress instead of re-arming.
    expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  });

  it('lets the update wait until later', async () => {
    const dismiss = vi.fn();
    const { user } = renderBanner({ needRefresh: true, dismiss });
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('stays away while a reload would lose a tap, and comes back once it would not', () => {
    const taps = holdUnkeptTaps();
    renderBanner({ needRefresh: true });
    expect(banner()).not.toBeInTheDocument();

    taps.keep();
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
  });

  it('offers the update afresh when a reload would have lost a tap as it was under way', async () => {
    const taps = holdUnkeptTaps();
    taps.keep();
    // It never gets as far as reloading (see reloadIfSafe).
    const update = vi.fn(() => Promise.resolve());
    const { user } = renderBanner({ needRefresh: true, update });
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled();

    // A tap held only in memory again (say, a failed Erase all data held its game's taps
    // again): the reload is held back, and the banner goes.
    taps.lose();
    expect(banner()).not.toBeInTheDocument();
    taps.keep();
    expect(screen.getByRole('button', { name: 'Update' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Later' })).toBeEnabled();
  });

  it('re-enables the buttons if the update fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    const { user } = renderBanner({ needRefresh: true, update });

    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(await screen.findByRole('button', { name: 'Update' })).toBeEnabled();
  });
});
