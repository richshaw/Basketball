import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from '@/components/UpdateBanner/UpdateBanner';
import { ServiceWorkerProvider } from './ServiceWorkerProvider';

const sw = vi.hoisted(() => ({
  needRefresh: true,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(() => Promise.resolve()),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [sw.needRefresh, sw.setNeedRefresh],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: sw.updateServiceWorker,
  }),
}));

describe('ServiceWorkerProvider', () => {
  it('shares the waiting update and activates it on request', async () => {
    const user = userEvent.setup();
    render(
      <ServiceWorkerProvider>
        <UpdateBanner />
      </ServiceWorkerProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(sw.updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('hides the prompt when dismissed', async () => {
    const user = userEvent.setup();
    render(
      <ServiceWorkerProvider>
        <UpdateBanner />
      </ServiceWorkerProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
  });
});
