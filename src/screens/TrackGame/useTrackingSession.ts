import { useEffect, useState, useSyncExternalStore } from 'react';
import { trackingSession, type SessionSnapshot, type TrackingSession } from './session';

/**
 * The game's tracking session (see session.ts) and what it shows. Keeps its period
 * in step with the saved game, and retries taps that couldn't be saved when the
 * screen opens and whenever the page is shown again (e.g. the app comes back from
 * the background, when a first write is the one most likely to fail).
 */
export function useTrackingSession(
  gameId: string,
  savedPeriod: number,
): [TrackingSession, SessionSnapshot] {
  // The screen is keyed by game, so the game never changes while it's mounted.
  const [session] = useState(() => trackingSession(gameId, savedPeriod));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  useEffect(() => session.syncSavedPeriod(savedPeriod), [session, savedPeriod]);

  useEffect(() => {
    session.retry();
    const retryWhenShown = () => {
      if (document.visibilityState === 'visible') session.retry();
    };
    document.addEventListener('visibilitychange', retryWhenShown);
    return () => document.removeEventListener('visibilitychange', retryWhenShown);
  }, [session]);

  return [session, snapshot];
}
