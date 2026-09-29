/**
 * What the two localStorage journals of the live game screen share: the pending-stats
 * journal (pendingStats.ts, taps not saved yet) and the pending-spots journal
 * (pendingSpots.ts, spots not on their saved stats yet). Nothing here throws.
 */

/** The game id in an entry, read loosely: an entry this version can't read has one too. */
function entryGameId(text: string): unknown {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>).gameId
      : undefined;
  } catch {
    return undefined;
  }
}

/** Entries taken out of a journal (see removeJournalEntries). */
export interface RemovedEntries {
  /** How many were taken out. */
  readonly count: number;
  /** Puts them back, as far as localStorage lets it (for when the write they went for fails). */
  putBack(): void;
}

/**
 * Takes out a journal's entries (the keys starting with `prefix`): one game's, or all of
 * them (then even an entry this version can't read, so no game id or stat type is left
 * behind).
 */
export function removeJournalEntries(prefix: string, gameId?: string): RemovedEntries {
  const removed: [key: string, text: string][] = [];
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) {
      const text = localStorage.getItem(key);
      if (text === null || (gameId !== undefined && entryGameId(text) !== gameId)) continue;
      localStorage.removeItem(key);
      removed.push([key, text]);
    }
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
  return {
    count: removed.length,
    putBack: () => {
      try {
        for (const [key, text] of removed) localStorage.setItem(key, text);
      } catch {
        // Full or blocked since: those entries can't be kept any more.
      }
    },
  };
}
