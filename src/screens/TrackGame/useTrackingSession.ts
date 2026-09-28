import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { StatEvent } from '@/data/types';
import { trackingSession, type SessionSnapshot, type TrackingSession } from './session';

/**
 * The game's tracking session (see session.ts) and what it shows. Keeps it in step
 * with the saved game (its stats and period), and saves the taps not saved yet when
 * the screen opens (including those an earlier page kept) and whenever the page is
 * shown again (e.g. the app comes back from the background, when a first write is the
 * one most likely to fail).
 */
export function useTrackingSession(
  gameId: string,
  savedPeriod: number,
  savedEvents: readonly StatEvent[],
): [TrackingSession, SessionSnapshot] {
  // The screen is keyed by game, so the game never changes while it's mounted.
  const [session] = useState(() => trackingSession(gameId, savedPeriod));
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  // Before the browser paints (and so before any tap): a tap always counts, and
  // undoes, against the saved stats on screen.
  useLayoutEffect(() => session.syncSavedEvents(savedEvents), [session, savedEvents]);
  useEffect(() => session.syncSavedPeriod(savedPeriod), [session, savedPeriod]);

  useEffect(() => {
    session.retry();
    const retryWhenShown = () => {
      if (document.visibilityState === 'visible') session.retry();
    };
    document.addEventListener('visibilitychange', retryWhenShown);
    return () => {
      document.removeEventListener('visibilitychange', retryWhenShown);
      // Whatever shows the game next reads the stats it saved afresh.
      session.forgetSaved();
    };
  }, [session]);

  return [session, snapshot];
}
