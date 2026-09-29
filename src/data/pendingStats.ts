/**
 * The pending-stats journal: stat taps from the live game screen that aren't
 * confirmed saved yet, kept in localStorage so they outlive the page.
 *
 * Each tap is written here synchronously, before its IndexedDB write starts, and
 * removed once that save is confirmed or the tap is undone. If the page reloads or
 * closes first (an iOS relaunch, the Update button), or IndexedDB keeps failing (WebKit
 * can lose its connection while the app is in the background, and every write fails
 * until it's back or the page reloads), what's left is saved later (pendingSaves.ts):
 * by the app-wide retry, at app start and while the app is open, and by the game's
 * tracking session when it starts.
 *
 * One key per tap, so keeping or removing one never rewrites the others. localStorage
 * may be missing, full or blocked: every access is guarded, nothing here throws, and
 * without it taps are still saved, just not kept across a reload.
 *
 * This module never touches the database (pendingSaves.ts saves the kept taps), so the
 * repository can use it too.
 */
import { isRealPoint } from '@/lib/court';
import { compareIds, newId } from '@/lib/id';
import { nextTimestamp } from './db';
import { isFieldGoalType } from './stats';
import type { CourtPoint, StatType } from './types';
import { statEventSchema } from './validation';

/** A stat tap that isn't confirmed saved yet: everything needed to save it. */
export interface PendingStat {
  /** The id its stat is saved under, so saving it again can't add it twice. */
  id: string;
  gameId: string;
  type: StatType;
  /** The period on screen at the tap. */
  period: number;
  /** When it was tapped (epoch ms): its stat's createdAt. */
  at: number;
  /** Where the shot was taken from (2PT/3PT only), if known. */
  location?: CourtPoint;
}

const KEY_PREFIX = 'hoop-stats.pendingStat.';

/**
 * A new tap, with its stat's id and its tap time: now, or just after `after` (the
 * latest stat or tap of the game, so taps keep their order even if the clock doesn't).
 */
export function newPendingStat(
  tap: Pick<PendingStat, 'gameId' | 'type' | 'period' | 'location'>,
  after?: number,
): PendingStat {
  const stat: PendingStat = {
    id: newId(),
    gameId: tap.gameId,
    type: tap.type,
    period: tap.period,
    at: nextTimestamp(Date.now(), after),
  };
  if (tap.location) stat.location = tap.location;
  return stat;
}

/**
 * Keeps a tap until it's saved: call it at the tap, before saving it. Returns false
 * if it couldn't be kept (no localStorage, or it's full); the tap then lives only in
 * memory.
 */
export function addPendingStat(stat: PendingStat): boolean {
  try {
    localStorage.setItem(KEY_PREFIX + stat.id, JSON.stringify(stat));
    return true;
  } catch {
    return false;
  }
}

/** Forgets a tap: it's saved, or it was undone. */
export function removePendingStat(id: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
}

/** Whether a tap is still kept (not saved or undone since). */
export function isPendingStat(id: string): boolean {
  try {
    return localStorage.getItem(KEY_PREFIX + id) !== null;
  } catch {
    return false;
  }
}

/** One entry, or undefined if it isn't a tap this version can save. */
function parseEntry(key: string, text: string | null): PendingStat | undefined {
  if (text === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, gameId, type, period, at, location } = value as Record<string, unknown>;
  // The checks its stat gets when it's saved, so a kept tap can always be saved.
  const checked = statEventSchema.safeParse({ id, gameId, type, period, createdAt: at });
  if (!checked.success || key !== KEY_PREFIX + checked.data.id) return undefined;
  const stat: PendingStat = {
    id: checked.data.id,
    gameId: checked.data.gameId,
    type: checked.data.type,
    period: checked.data.period,
    at: checked.data.createdAt,
  };
  // Like recordStat, a location that can't be saved is dropped, never the tap.
  if (isRealPoint(location) && isFieldGoalType(stat.type)) {
    stat.location = { x: location.x, y: location.y };
  }
  return stat;
}

/**
 * The kept taps, in tap order: all of them, or one game's. An entry this version
 * can't read is skipped but left alone (a newer version of the app may have kept it).
 */
export function listPendingStats(gameId?: string): PendingStat[] {
  const stats: PendingStat[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const stat = parseEntry(key, localStorage.getItem(key));
      if (stat && (gameId === undefined || stat.gameId === gameId)) stats.push(stat);
    }
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
  return stats.sort((a, b) => a.at - b.at || compareIds(a.id, b.id));
}

// ---------------------------------------------------------------------------
// Taps held in memory, and whether anything is pending

/**
 * Taps held in memory that aren't saved yet: a tracking session's (see
 * src/screens/TrackGame/session.ts), including any it couldn't keep in the journal.
 */
export interface UnsavedTapHolder {
  /** The game whose taps it holds. */
  readonly gameId: string;
  /** Whether it holds a tap that isn't saved yet (or a taken-back one to remove again). */
  hasUnsaved(): boolean;
  /**
   * Tries again to save them without showing it on screen (only a save that lands
   * changes anything there). Settles once those tries are done; never rejects.
   */
  retryQuietly(): Promise<void>;
  /**
   * Its game's data was deleted or replaced (no id), or one stat was deleted (its id):
   * forgets those taps, never saving them.
   */
  forget(id?: string): void;
}

const holders = new Set<UnsavedTapHolder>();

/**
 * Registers taps held in memory for the app-wide retry. Returns a function that
 * unregisters them.
 */
export function holdUnsavedTaps(holder: UnsavedTapHolder): () => void {
  holders.add(holder);
  return () => {
    holders.delete(holder);
  };
}

/** Tries again to save the taps held in memory (quietly). Never rejects. */
export async function retryHeldTaps(): Promise<void> {
  await Promise.all(
    [...holders].map(async (holder) => {
      try {
        await holder.retryQuietly();
      } catch {
        // Tried again next time.
      }
    }),
  );
}

/**
 * Whether any tap isn't saved yet: kept in the journal (by this page or an earlier
 * one), or held in memory.
 */
export function hasPendingStats(): boolean {
  return listPendingStats().length > 0 || [...holders].some((holder) => holder.hasUnsaved());
}

const listeners = new Set<() => void>();

/** Calls `listener` whenever a tap may have become pending. Returns a function that stops it. */
export function watchPendingStats(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Says a tap may be pending now (e.g. its save just failed), to wake the app-wide retry. */
export function notifyPendingStats(): void {
  for (const listener of [...listeners]) listener();
}

// ---------------------------------------------------------------------------
// Forgetting taps whose data is deleted or replaced

/** The game id in an entry, read loosely: an entry this version can't save has one too. */
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

/**
 * Forgets the kept taps of one game, or of every game (then every entry, even one this
 * version can't read, so no game id or stat type is left behind), and has the sessions
 * holding such taps in memory forget theirs. For writes that delete or replace a game's
 * data: no retry may save one of its taps into it afterwards (say, into a game restored
 * or made again under the same id). Call it just before that write, so a save asked for
 * earlier lands first and goes with it. Returns a function that keeps the forgotten
 * entries again, for when the write fails.
 */
export function forgetPendingStats(gameId?: string): () => void {
  const forgotten: [key: string, text: string][] = [];
  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const text = localStorage.getItem(key);
      if (text === null || (gameId !== undefined && entryGameId(text) !== gameId)) continue;
      localStorage.removeItem(key);
      forgotten.push([key, text]);
    }
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
  for (const holder of [...holders]) {
    if (gameId === undefined || holder.gameId === gameId) holder.forget();
  }
  return () => {
    if (forgotten.length === 0) return;
    try {
      for (const [key, text] of forgotten) localStorage.setItem(key, text);
    } catch {
      // Full or blocked since: those taps can't be kept any more.
    }
    notifyPendingStats();
  };
}

/**
 * Forgets one tap by its stat's id, kept or held in memory, just before that stat is
 * deleted: no retry may save it again afterwards.
 */
export function forgetPendingStat(id: string): void {
  removePendingStat(id);
  for (const holder of [...holders]) holder.forget(id);
}
