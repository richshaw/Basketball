import { useEffect, useState } from 'react';

/**
 * The current time, updated every `intervalMs` while the component is mounted, so
 * "Backed up 2 minutes ago" stays true while the screen is open.
 */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
