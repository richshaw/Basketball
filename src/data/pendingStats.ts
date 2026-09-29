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
 * Only taps live here: an entry is a stat to save, and saving it again after its stat
 * was deleted would bring the stat back. A shot's spot (the shot chart) is kept with its
 * tap while the tap isn't saved; a spot for a stat that's saved already is kept in the
 * pending-spots journal (pendingSpots.ts), which never adds a stat; a tap taken back
 * whose stat may still have to be removed is kept in the pending-removals journal
 * (pendingRemovals.ts); and a move to another period not saved yet, in the
 * pending-periods journal (pendingPeriods.ts). What's pending, and what's forgotten when
 * data is deleted or replaced, covers all four journals.
 *
 * This module never touches the database (pendingSaves.ts saves the kept taps and
 * spots), so the repository can use it too.
 */
import { isRealPoint } from '@/lib/court';
import { compareIds, newId } from '@/lib/id';
import { nextTimestamp } from './db';
import {
  listJournalEntries,
  parseJournalEntry,
  removeJournalEntries,
  removeJournalEntry,
  writeJournalEntry,
} from './journal';
import { forgetPendingPeriods, listPendingPeriods } from './pendingPeriods';
import { forgetPendingRemovals, listPendingRemovals } from './pendingRemovals';
import { forgetPendingSpots, listPendingSpots } from './pendingSpots';
import { isFieldGoalType } from './stats';
import type { CourtPoint, StatEvent, StatType } from './types';
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
  return writeJournalEntry(KEY_PREFIX + stat.id, stat);
}

/** Forgets a tap: it's saved, or it was undone. */
export function removePendingStat(id: string): void {
  removeJournalEntry(KEY_PREFIX + id);
}

/**
 * Whether a tap is still kept (not saved or undone since): true or false, or undefined
 * when localStorage can't be read right now. Only false says it's gone.
 */
export function isPendingStat(id: string): boolean | undefined {
  try {
    return localStorage.getItem(KEY_PREFIX + id) !== null;
  } catch {
    return undefined;
  }
}

/** One entry, or undefined if it isn't a tap this version can save. */
function parseEntry(key: string, text: string | null): PendingStat | undefined {
  const value = parseJournalEntry(text);
  if (!value) return undefined;
  const { id, gameId, type, period, at, location } = value;
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
  return listJournalEntries(KEY_PREFIX, parseEntry, gameId).sort(
    (a, b) => a.at - b.at || compareIds(a.id, b.id),
  );
}

// ---------------------------------------------------------------------------
// Taps held in memory, and whether anything is pending

/**
 * Taps held in memory that aren't saved yet: a tracking session's (see
 * src/screens/TrackGame/session.ts), including any it couldn't keep in the journal, and
 * the spots it's still putting on saved stats (the shot chart).
 */
export interface UnsavedTapHolder {
  /** The game whose taps it holds. */
  readonly gameId: string;
  /**
   * Whether it holds a tap or a spot that isn't saved yet (or a taken-back tap to remove
   * again).
   */
  hasUnsaved(): boolean;
  /**
   * Whether reloading the page now would lose nothing it holds: each of its taps and
   * spots that isn't saved yet is kept in a journal, and nothing is still being taken
   * back (a reload would forget to remove its stat) or moved to another period.
   */
  reloadSafe(): boolean;
  /**
   * Tries again to save them without showing it on screen (only a save that lands
   * changes anything there). Settles once those tries are done; never rejects.
   */
  retryQuietly(): Promise<void>;
  /**
   * One of its taps was saved from the journal (by the app-wide retry), as `event`: it's
   * saved, and must still count until the saved stats on screen show it (and get the spot
   * marked for it meanwhile, if `event` lacks it).
   */
  saved(id: string, event: StatEvent): void;
  /**
   * Its game's data is being deleted or replaced (no id), or one stat is (its id):
   * forgets those taps, never saving them. Returns a function that holds them again,
   * for when that write fails.
   */
  forget(id?: string): () => void;
  /**
   * Calls `listener` whenever what it holds changes (so reloadSafe() may have), until
   * the function it returns is called. For watchReloadSafe(); a holder whose
   * reloadSafe() never changes can leave it out.
   */
  subscribe?(listener: () => void): () => void;
}

const holders = new Set<UnsavedTapHolder>();

/** watchReloadSafe()'s listeners. */
const reloadWatchers = new Set<() => void>();

function tellReloadWatchers(): void {
  for (const watcher of [...reloadWatchers]) watcher();
}

/**
 * Registers taps held in memory for the app-wide retry. Returns a function that
 * unregisters them.
 */
export function holdUnsavedTaps(holder: UnsavedTapHolder): () => void {
  holders.add(holder);
  const unsubscribe = holder.subscribe?.(tellReloadWatchers);
  tellReloadWatchers();
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    holders.delete(holder);
    unsubscribe?.();
    tellReloadWatchers();
  };
}

/**
 * A kept tap was saved from the journal (replayPendingStats), as `event`: forgets it,
 * and tells the sessions holding it that it's saved, so they keep counting it until the
 * saved stats on screen show it, rather than taking its missing entry to mean it's gone.
 */
export function pendingStatSaved(id: string, event: StatEvent): void {
  removePendingStat(id);
  for (const holder of [...holders]) holder.saved(id, event);
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
 * Whether reloading the page now would lose nothing held in memory, for any game (see
 * UnsavedTapHolder.reloadSafe): what the journals keep outlives the page anyway.
 */
export function isReloadSafe(): boolean {
  return [...holders].every((holder) => holder.reloadSafe());
}

/**
 * Calls `listener` whenever isReloadSafe() may have changed: a holder's taps changed, or
 * one was registered or let go. Returns a function that stops it. (useReloadSafe in
 * hooks.ts, for the Reload buttons.)
 */
export function watchReloadSafe(listener: () => void): () => void {
  reloadWatchers.add(listener);
  return () => {
    reloadWatchers.delete(listener);
  };
}

/**
 * Whether any tap (or spot, or removal of a tap taken back, or move to another period)
 * isn't saved yet: kept in a journal (by this page or an earlier one), or held in memory.
 */
export function hasPendingStats(): boolean {
  return (
    listPendingStats().length > 0 ||
    listPendingSpots().length > 0 ||
    listPendingRemovals().length > 0 ||
    listPendingPeriods().length > 0 ||
    [...holders].some((holder) => holder.hasUnsaved())
  );
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

/**
 * Forgets the kept taps of one game, or of every game (then every entry, even one this
 * version can't read, so no game id or stat type is left behind), the spots kept for
 * their stats (pendingSpots.ts), the removals kept for taps taken back
 * (pendingRemovals.ts) and the moves to another period (pendingPeriods.ts) too, and has
 * the sessions holding such taps and spots in memory forget theirs. For writes that
 * delete or replace a game's data: no retry may save one of its taps into it afterwards,
 * put one of its spots on a stat, remove one of its stats or move it to another period,
 * say in a game restored or made again under the same id. Call it just before that
 * write, so a save asked for earlier lands first and goes with it. Returns a function
 * that keeps the forgotten entries again and has the sessions hold theirs again, for
 * when the write fails.
 */
export function forgetPendingStats(gameId?: string): () => void {
  const taps = removeJournalEntries(KEY_PREFIX, gameId);
  const spots = forgetPendingSpots(gameId);
  const removals = forgetPendingRemovals(gameId);
  const periods = forgetPendingPeriods(gameId);
  const holdAgain: (() => void)[] = [];
  for (const holder of [...holders]) {
    if (gameId === undefined || holder.gameId === gameId) holdAgain.push(holder.forget());
  }
  return () => {
    const count = taps.count + spots.count + removals.count + periods.count;
    if (count === 0 && holdAgain.length === 0) return;
    taps.putBack();
    spots.putBack();
    removals.putBack();
    periods.putBack();
    // After the entries: a session's kept taps and spots are back in the journals by then.
    for (const again of holdAgain) again();
    // The app-wide retry wakes up for them.
    notifyPendingStats();
  };
}

/**
 * Forgets one tap by its stat's id, kept or held in memory, just before that stat is
 * deleted: no retry may save it again afterwards. Nothing needs to come back if that
 * delete fails: the stat is saved (that's how it can be deleted), and it stays. (A spot
 * kept for the stat is forgotten only once the delete has worked, by deleteStat: a spot
 * never brings back its stat, so it can wait, and it's still saved if the stat stays.)
 */
export function forgetPendingStat(id: string): void {
  removePendingStat(id);
  for (const holder of [...holders]) holder.forget(id);
}
