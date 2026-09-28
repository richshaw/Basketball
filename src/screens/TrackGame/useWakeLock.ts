import { useEffect } from 'react';

/**
 * Keeps the screen on while the component is mounted (and `enabled`), so the phone
 * doesn't lock in the middle of a game. The browser drops the lock whenever the
 * page is hidden (and may drop it at other times), so it's asked for again each time
 * the page becomes visible or the lock is let go while the page shows.
 * Best effort: unsupported browsers and refusals (e.g. low battery) are ignored.
 */
export function useWakeLock(enabled = true): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    const wakeLock = navigator.wakeLock as WakeLock | undefined;
    if (typeof wakeLock?.request !== 'function') return;

    let mounted = true;
    let sentinel: WakeLockSentinel | null = null;
    let requesting = false;
    // The page was shown again while a request was under way (one made just before
    // it was hidden fails): ask once more when that request is done.
    let askAgain = false;

    const release = (lock: WakeLockSentinel) => {
      if (!lock.released) lock.release().catch(() => {});
    };

    const settled = () => {
      requesting = false;
      if (askAgain) {
        askAgain = false;
        request();
      }
    };

    const request = () => {
      const holdingLock = sentinel !== null && !sentinel.released;
      if (!mounted || holdingLock || document.visibilityState !== 'visible') return;
      if (requesting) {
        askAgain = true;
        return;
      }
      requesting = true;
      let pending: Promise<WakeLockSentinel>;
      try {
        pending = wakeLock.request('screen');
      } catch {
        requesting = false;
        return;
      }
      pending.then((lock) => {
        if (!mounted) {
          // Unmounted while waiting: hand the lock straight back.
          release(lock);
          return;
        }
        sentinel = lock;
        // Let go by the system while the page still shows: ask for it again.
        lock.addEventListener('release', () => {
          if (sentinel === lock) request();
        });
        settled();
      }, settled);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') request();
    };

    request();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (sentinel) release(sentinel);
      sentinel = null;
    };
  }, [enabled]);
}
