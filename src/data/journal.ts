/**
 * What the four localStorage journals of the live game screen share: the pending-stats
 * journal (pendingStats.ts, taps not saved yet), the pending-spots journal
 * (pendingSpots.ts, spots not on their saved stats yet), the pending-removals journal
 * (pendingRemovals.ts, taps taken back whose stat may still have to be removed) and the
 * pending-periods journal (pendingPeriods.ts, moves to another period not saved yet).
 * Each keeps one entry per stat (per game, for the periods), under its own key prefix and
 * the stat's (or game's) id, so keeping or forgetting one never rewrites another; each
 * entry holds its game's id. Nothing here throws: without localStorage (full, blocked),
 * nothing is kept, and nothing is lost but what a reload would forget.
 */

/** How many entries have been kept or forgotten through this module, on this page. */
let changes = 0;
/** When each key was last kept or forgotten (its number in `changes`). */
const changedAt = new Map<string, number>();

function changed(key: string): void {
  changes += 1;
  changedAt.set(key, changes);
}

/**
 * Keeps `entry` under `key`, replacing what was kept there. Returns false if it
 * couldn't be kept (no localStorage, or it's full).
 */
export function writeJournalEntry(key: string, entry: object): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
    changed(key);
    return true;
  } catch {
    return false;
  }
}

/** Forgets what's kept under `key`, if anything. */
export function removeJournalEntry(key: string): void {
  changed(key);
  try {
    localStorage.removeItem(key);
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
}

/** The object an entry holds, or undefined if it holds no object (or nothing). */
export function parseJournalEntry(text: string | null): Record<string, unknown> | undefined {
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A journal's entries (the keys starting with `prefix`) that `read` can read: all of
 * them, or one game's. An entry it can't read (one a newer version of the app kept,
 * say) is skipped, and left alone.
 */
export function listJournalEntries<T extends { gameId: string }>(
  prefix: string,
  read: (key: string, text: string | null) => T | undefined,
  gameId?: string,
): T[] {
  const entries: T[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const entry = read(key, localStorage.getItem(key));
      if (entry && (gameId === undefined || entry.gameId === gameId)) entries.push(entry);
    }
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
  return entries;
}

/** The game id in an entry, read loosely: an entry this version can't read has one too. */
function entryGameId(text: string): unknown {
  return parseJournalEntry(text)?.gameId;
}

/** Entries taken out of a journal (see removeJournalEntries). */
export interface RemovedEntries {
  /** How many were taken out. */
  readonly count: number;
  /**
   * Puts them back, as far as localStorage lets it (for when the write they went for
   * fails): all but those kept or forgotten since. One dealt with meanwhile (its removal
   * given up as its stat stays, say) mustn't come back as it was.
   */
  putBack(): void;
}

/**
 * Takes out a journal's entries (the keys starting with `prefix`): one game's, or all of
 * them (then even an entry this version can't read, so no game id or stat type is left
 * behind).
 */
export function removeJournalEntries(prefix: string, gameId?: string): RemovedEntries {
  const takenAt = changes;
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
        for (const [key, text] of removed) {
          if ((changedAt.get(key) ?? 0) <= takenAt) localStorage.setItem(key, text);
        }
      } catch {
        // Full or blocked since: those entries can't be kept any more.
      }
    },
  };
}
