/**
 * The pending-stats journal: stat taps from the live game screen that aren't
 * confirmed saved yet, kept in localStorage so they outlive the page.
 *
 * Each tap is written here synchronously, before its IndexedDB write starts, and
 * removed once that save is confirmed or the tap is undone. If the page reloads or
 * closes first (an iOS relaunch, the Update button), or IndexedDB keeps failing (WebKit
 * can lose its connection while the app is in the background, and every write fails
 * until it's back or the page reloads), what's left is saved later: by
 * replayPendingStats() at app start, and by the game's tracking session when it starts.
 *
 * One key per tap, so keeping or removing one never rewrites the others. Saving an
 * entry is idempotent (recordStat with the tap's id), so an entry saved twice is still
 * one stat. localStorage may be missing, full or blocked: every access is guarded,
 * nothing here throws, and without it taps are still saved, just not kept across a
 * reload.
 */
import { isRealPoint } from '@/lib/court';
import { compareIds, newId } from '@/lib/id';
import { nextTimestamp } from './db';
import { getGame, recordStat } from './repo';
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

/** Saves a tap as its stat. Idempotent: a tap saved already resolves to its stat. */
export function savePendingStat(stat: PendingStat): Promise<StatEvent> {
  return recordStat(stat.gameId, stat.type, stat.location, {
    id: stat.id,
    at: stat.at,
    period: stat.period,
  });
}

export interface ReplayResult {
  /** Saved (or found saved already) and forgotten. */
  saved: number;
  /** Their game no longer exists: forgotten without saving. */
  dropped: number;
  /** Couldn't be saved: still kept, for next time. */
  failed: number;
}

/**
 * Saves the taps kept by a page that closed (or couldn't reach the database) before
 * they were saved. Called at app start, in the background. Each is saved at most once
 * and then forgotten; one that can't be saved stays kept for next time, and one whose
 * game no longer exists is dropped. Stats can be added to finished games, so their
 * taps are saved too. Never rejects.
 */
export async function replayPendingStats(): Promise<ReplayResult> {
  const result: ReplayResult = { saved: 0, dropped: 0, failed: 0 };
  const gameExists = new Map<string, Promise<boolean>>();
  for (const stat of listPendingStats()) {
    let exists = gameExists.get(stat.gameId);
    if (!exists) {
      exists = getGame(stat.gameId).then((game) => game !== undefined);
      gameExists.set(stat.gameId, exists);
    }
    try {
      if (!(await exists)) {
        removePendingStat(stat.id);
        result.dropped += 1;
        continue;
      }
      // Undone (or saved) meanwhile, e.g. on the live game screen: leave it be. The
      // save starts right after this check, so an Undo can't slip in between.
      if (!isPendingStat(stat.id)) continue;
      await savePendingStat(stat);
      removePendingStat(stat.id);
      result.saved += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
