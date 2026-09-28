import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

/** A stand-in for the browser's WakeLockSentinel. */
class FakeSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  onrelease = null;
  release = vi.fn(() => {
    this.released = true;
    return Promise.resolve();
  });
}

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Installs a fake navigator.wakeLock whose request() resolves with fresh sentinels. */
function installWakeLock(request?: () => Promise<FakeSentinel>) {
  const sentinels: FakeSentinel[] = [];
  const fake = {
    request: vi.fn(
      request ??
        (() => {
          const sentinel = new FakeSentinel();
          sentinels.push(sentinel);
          return Promise.resolve(sentinel);
        }),
    ),
  };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: fake });
  return { request: fake.request, sentinels };
}

beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('useWakeLock', () => {
  it('keeps the screen on while mounted and lets go on unmount', async () => {
    const { request, sentinels } = installWakeLock();
    const { unmount } = renderHook(() => useWakeLock());

    expect(request).toHaveBeenCalledExactlyOnceWith('screen');
    await waitFor(() => expect(sentinels).toHaveLength(1));

    unmount();
    expect(sentinels[0]?.release).toHaveBeenCalledOnce();
  });

  it('asks again when the page becomes visible, since hiding it drops the lock', async () => {
    const { request, sentinels } = installWakeLock();
    renderHook(() => useWakeLock());
    await waitFor(() => expect(sentinels).toHaveLength(1));

    // The browser releases the lock itself while the page is hidden.
    act(() => {
      setVisibility('hidden');
      if (sentinels[0]) sentinels[0].released = true;
    });
    expect(request).toHaveBeenCalledOnce();

    act(() => setVisibility('visible'));
    expect(request).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(sentinels).toHaveLength(2));

    // Still holding the new lock: becoming visible again doesn't ask twice.
    act(() => setVisibility('visible'));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('waits until the page is visible before asking', () => {
    const { request } = installWakeLock();
    visibility = 'hidden';
    renderHook(() => useWakeLock());
    expect(request).not.toHaveBeenCalled();

    act(() => setVisibility('visible'));
    expect(request).toHaveBeenCalledOnce();
  });

  it('hands back a lock granted after unmounting', async () => {
    let grant: (sentinel: FakeSentinel) => void = () => {};
    const { request } = installWakeLock(
      () => new Promise<FakeSentinel>((resolve) => (grant = resolve)),
    );
    const { unmount } = renderHook(() => useWakeLock());
    expect(request).toHaveBeenCalledOnce();

    unmount();
    const late = new FakeSentinel();
    grant(late);
    await waitFor(() => expect(late.release).toHaveBeenCalledOnce());
  });

  it('does nothing while disabled, and stops listening once unmounted', () => {
    const { request } = installWakeLock();
    const { rerender, unmount } = renderHook(({ enabled }) => useWakeLock(enabled), {
      initialProps: { enabled: false },
    });
    expect(request).not.toHaveBeenCalled();

    rerender({ enabled: true });
    expect(request).toHaveBeenCalledOnce();

    unmount();
    act(() => setVisibility('visible'));
    expect(request).toHaveBeenCalledOnce();
  });

  it('ignores browsers without wake lock, and refusals', async () => {
    expect(() => renderHook(() => useWakeLock()).unmount()).not.toThrow();

    const { request } = installWakeLock(() =>
      Promise.reject(new DOMException('No', 'NotAllowedError')),
    );
    const { unmount } = renderHook(() => useWakeLock());
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    // A refusal isn't retried until the page is shown again.
    act(() => setVisibility('visible'));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    unmount();

    installWakeLock(() => {
      throw new TypeError('Not supported');
    });
    expect(() => renderHook(() => useWakeLock()).unmount()).not.toThrow();
  });
});
