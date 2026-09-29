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
 * is simply dropped. replayPendingStats() saves what's left here at app start, and a
 * game's tracking session saves its game's spots when it starts.
 *
 * One key per stat, `hoop-stats.pendingSpot.<id>`, holding `{ id, gameId, location }`.
 * Like the pending-stats journal, nothing here throws: without localStorage, spots are
 * still saved, just not kept across a reload.
 */
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
  try {
    localStorage.setItem(KEY_PREFIX + spot.id, JSON.stringify(spot));
    return true;
  } catch {
    return false;
  }
}

/** Forgets a stat's kept spot: it's saved, or the stat is gone. */
export function removePendingSpot(id: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
}

function isRealPoint(value: unknown): value is CourtPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return Number.isFinite(x) && Number.isFinite(y);
}

/** One entry, or undefined if it isn't a spot this version can save. */
function parseEntry(key: string, text: string | null): PendingSpot | undefined {
  if (text === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, gameId, location } = value as Record<string, unknown>;
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
  const spots: PendingSpot[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const spot = parseEntry(key, localStorage.getItem(key));
      if (spot && (gameId === undefined || spot.gameId === gameId)) spots.push(spot);
    }
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
  return spots;
}

/** Forgets every spot kept for a game's stats (the game was deleted). */
export function removeGamePendingSpots(gameId: string): void {
  for (const spot of listPendingSpots(gameId)) removePendingSpot(spot.id);
}
