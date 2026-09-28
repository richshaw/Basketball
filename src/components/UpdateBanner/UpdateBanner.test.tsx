import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

  it('re-enables the buttons if the update fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const update = vi.fn(() => Promise.reject(new Error('offline')));
    const { user } = renderBanner({ needRefresh: true, update });

    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(await screen.findByRole('button', { name: 'Update' })).toBeEnabled();
  });
});
