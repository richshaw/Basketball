import { useEffect } from 'react';

/**
 * Keeps the screen on while the component is mounted (and `enabled`), so the phone
 * doesn't lock in the middle of a game. The browser drops the lock whenever the
 * page is hidden, so it's asked for again each time the page becomes visible.
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

    const release = (lock: WakeLockSentinel) => {
      if (!lock.released) lock.release().catch(() => {});
    };

    const request = () => {
      const holdingLock = sentinel !== null && !sentinel.released;
      if (!mounted || requesting || holdingLock || document.visibilityState !== 'visible') return;
      requesting = true;
      let pending: Promise<WakeLockSentinel>;
      try {
        pending = wakeLock.request('screen');
      } catch {
        requesting = false;
        return;
      }
      pending.then(
        (lock) => {
          requesting = false;
          // Unmounted while waiting: hand the lock straight back.
          if (mounted) sentinel = lock;
          else release(lock);
        },
        () => {
          requesting = false;
        },
      );
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
