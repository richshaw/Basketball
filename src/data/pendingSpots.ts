/**
 * The pending-spots journal: where shots were taken (marked on the live game screen's
 * court) that still have to be put on their saved stats, kept in localStorage so they
 * outlive the page.
 *
 * A spot marked for a shot whose tap isn't saved yet goes into that tap's own entry in
 * the pending-stats journal (pendingStats.ts) and is saved with it. A spot for a stat
 * that's saved already is kept here instead, until setStatLocation has put it on the
 * stat. The difference matters: a kept tap is saved again (recordStat), which would
 * bring back a stat deleted since; a kept spot is only ever put on its stat
 * (setStatLocation), so if the stat is gone (deleted on the game report, say) the spot
 * is simply dropped. replayPendingStats() (pendingSaves.ts) saves what's left here, at
 * app start and with every try of the app-wide retry, and a game's tracking session
 * saves its game's spots when it starts.
 *
 * One key per stat, `hoop-stats.pendingSpot.<id>`, holding `{ id, gameId, location }`.
 * Like the pending-stats journal, nothing here throws: without localStorage, spots are
 * still saved, just not kept across a reload.
 */
import { isRealPoint } from '@/lib/court';
import {
  listJournalEntries,
  parseJournalEntry,
  removeJournalEntries,
  removeJournalEntry,
  writeJournalEntry,
  type RemovedEntries,
} from './journal';
import type { CourtPoint } from './types';

/** A spot to put on a saved stat. */
export interface PendingSpot {
  /** The stat's id. */
  id: string;
  gameId: string;
  /** Where the shot was taken (feet, see CourtPoint). */
  location: CourtPoint;
}

const KEY_PREFIX = 'hoop-stats.pendingSpot.';

/** Keeps a stat's spot until it's saved (replacing a spot kept for it before). */
export function addPendingSpot(spot: PendingSpot): boolean {
  return writeJournalEntry(KEY_PREFIX + spot.id, spot);
}

/** Forgets a stat's kept spot: it's saved, or the stat is gone. */
export function removePendingSpot(id: string): void {
  removeJournalEntry(KEY_PREFIX + id);
}

/** One entry, or undefined if it isn't a spot this version can save. */
function parseEntry(key: string, text: string | null): PendingSpot | undefined {
  const value = parseJournalEntry(text);
  if (!value) return undefined;
  const { id, gameId, location } = value;
  if (typeof id !== 'string' || !id || key !== KEY_PREFIX + id) return undefined;
  if (typeof gameId !== 'string' || !gameId || !isRealPoint(location)) return undefined;
  return { id, gameId, location: { x: location.x, y: location.y } };
}

/** The spot kept for a stat, if any. */
export function getPendingSpot(id: string): PendingSpot | undefined {
  try {
    return parseEntry(KEY_PREFIX + id, localStorage.getItem(KEY_PREFIX + id));
  } catch {
    return undefined;
  }
}

/**
 * The kept spots: all of them, or one game's. An entry this version can't read is
 * skipped but left alone.
 */
export function listPendingSpots(gameId?: string): PendingSpot[] {
  return listJournalEntries(KEY_PREFIX, parseEntry, gameId);
}

/**
 * Forgets the spots kept for one game's stats, or for every stat (then every entry, even
 * one this version can't read). For writes that delete or replace data, through
 * forgetPendingStats (pendingStats.ts): no spot may be put on a stat restored or made
 * again under the same id afterwards. Says how to keep them again if the write fails.
 */
export function forgetPendingSpots(gameId?: string): RemovedEntries {
  return removeJournalEntries(KEY_PREFIX, gameId);
}
