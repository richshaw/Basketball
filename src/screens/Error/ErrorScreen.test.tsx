import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
