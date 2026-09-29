import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { holdUnsavedTaps } from '@/data/pendingStats';
import {
  noServiceWorkerUpdate,
  ServiceWorkerContext,
  type ServiceWorkerUpdate,
} from '@/pwa/serviceWorkerContext';
import { paths } from '@/routes';
import { ErrorScreen } from './ErrorScreen';

function Broken(): never {
  throw new Error('boom');
}

/**
 * Taps a (fake) live game screen holds only in memory, until the test ends: a reload
 * would lose them until `keep()` (say, the app-wide retry saved them).
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
  return {
    keep: () => {
      safe = true;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    },
  };
}

const KEEP_OPEN = 'Keep the app open until your taps are saved.';

/** Renders a route that crashes at `path`, caught by ErrorScreen. */
function renderCrash(path: string, serviceWorker: Partial<ServiceWorkerUpdate> = {}) {
  const router = createMemoryRouter(
    [{ ErrorBoundary: ErrorScreen, children: [{ path: '*', Component: Broken }] }],
    { initialEntries: [path] },
  );
  const user = userEvent.setup();
  render(
    <ServiceWorkerContext value={{ ...noServiceWorkerUpdate, ...serviceWorker }}>
      <RouterProvider router={router} />
    </ServiceWorkerContext>,
  );
  return { user };
}

describe('ErrorScreen', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('offers a way back to Games and a reload', () => {
    renderCrash(paths.trackGame('g1'));

    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Games' })).toHaveAttribute('href', paths.home);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update app' })).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Screen crashed', expect.any(Error));
  });

  it('offers the waiting update, which is often the fix', async () => {
    const update = vi.fn(() => Promise.resolve());
    const { user } = renderCrash(paths.stats, { needRefresh: true, update });

    await user.click(screen.getByRole('button', { name: 'Update app' }));

    expect(update).toHaveBeenCalledTimes(1);
  });

  it('skips "Go to Games" when Games itself crashed', () => {
    renderCrash(paths.home);

    expect(screen.queryByRole('link', { name: 'Go to Games' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('offers Reload (and the update) only while a reload would lose nothing, and says to keep the app open meanwhile', () => {
    const taps = holdUnkeptTaps();
    renderCrash(paths.trackGame('g1'), { needRefresh: true });

    expect(screen.getByText(new RegExp(KEEP_OPEN))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    // Updating reloads the page too.
    expect(screen.queryByRole('button', { name: 'Update app' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Games' })).toBeInTheDocument();

    // They're saved (or kept on the phone): both are offered at once.
    taps.keep();
    expect(screen.getByRole('button', { name: 'Update app' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(KEEP_OPEN))).not.toBeInTheDocument();
  });

  it('on Games, says only to keep the app open while a reload would lose taps', () => {
    const taps = holdUnkeptTaps();
    renderCrash(paths.home);
    expect(screen.getByText(new RegExp(KEEP_OPEN))).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    taps.keep();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
