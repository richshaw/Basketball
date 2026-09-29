import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { UpdateBanner } from '@/components/UpdateBanner/UpdateBanner';
import { holdUnsavedTaps } from '@/data/pendingStats';
import { reloadIfSafe } from './reload';
import { applyUpdate, watchForTakeover } from './updates';
import { ServiceWorkerProvider } from './ServiceWorkerProvider';

const sw = vi.hoisted(() => ({
  options: undefined as RegisterSWOptions | undefined,
  setNeedRefresh: vi.fn(),
  updateServiceWorker: vi.fn(() => Promise.resolve()),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: RegisterSWOptions) => {
    sw.options = options;
    return {
      needRefresh: [true, sw.setNeedRefresh],
      offlineReady: [false, vi.fn()],
      updateServiceWorker: sw.updateServiceWorker,
    };
  },
}));

vi.mock('./updates', () => ({
  applyUpdate: vi.fn(() => Promise.resolve()),
  watchForTakeover: vi.fn(() => () => {}),
}));

// (reload.test.ts checks it reloads only while that would lose nothing.)
vi.mock('./reload', () => ({ reloadIfSafe: vi.fn(() => false) }));

function renderProvider() {
  const user = userEvent.setup();
  render(
    <ServiceWorkerProvider>
      <UpdateBanner />
    </ServiceWorkerProvider>,
  );
  return { user };
}

describe('ServiceWorkerProvider', () => {
  it('never lets the plugin reload windows on its own', () => {
    renderProvider();
    // With onNeedReload set, vite-plugin-pwa calls it instead of reloading every window.
    expect(sw.options?.onNeedReload).toBeTypeOf('function');
    expect(() => sw.options?.onNeedReload?.()).not.toThrow();
  });

  it('applies the waiting update when asked', async () => {
    const { user } = renderProvider();

    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(applyUpdate).toHaveBeenCalledTimes(1);
    const [options] = vi.mocked(applyUpdate).mock.calls[0] ?? [];
    await options?.activateWaitingWorker();
    expect(sw.updateServiceWorker).toHaveBeenCalledTimes(1);
  });

  it('activates the new version only while a reload would lose nothing', async () => {
    const { user } = renderProvider();
    await user.click(screen.getByRole('button', { name: 'Update' }));
    const [options] = vi.mocked(applyUpdate).mock.calls[0] ?? [];
    expect(options?.mayReload?.()).toBe(true);

    // A live game screen holds a tap only in memory: no longer.
    onTestFinished(
      holdUnsavedTaps({
        gameId: 'g1',
        hasUnsaved: () => true,
        reloadSafe: () => false,
        retryQuietly: () => Promise.resolve(),
        saved: () => {},
        forget: () => () => {},
      }),
    );
    expect(options?.mayReload?.()).toBe(false);
  });

  it('reloads into the new version only through reloadIfSafe: never while that would lose a tap', async () => {
    const { user } = renderProvider();
    await user.click(screen.getByRole('button', { name: 'Update' }));
    const [options] = vi.mocked(applyUpdate).mock.calls[0] ?? [];

    options?.reload();
    expect(reloadIfSafe).toHaveBeenCalledTimes(1);
  });

  it('offers the update when another window already switched to it', () => {
    renderProvider();
    const [, onTakeover] = vi.mocked(watchForTakeover).mock.calls[0] ?? [];

    act(() => onTakeover?.());

    expect(sw.setNeedRefresh).toHaveBeenCalledWith(true);
  });

  it('hides the prompt when dismissed', async () => {
    const { user } = renderProvider();

    await user.click(screen.getByRole('button', { name: 'Later' }));

    expect(sw.setNeedRefresh).toHaveBeenCalledWith(false);
  });
});
