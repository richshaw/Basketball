/**
 * Saving the taps (and shot spots, and removals of taps taken back) that aren't saved yet
 * into the database: one kept tap (savePendingStat), everything kept in the journals
 * (replayPendingStats), and the app-wide retry (startPendingStatsRetry), which keeps
 * trying while anything isn't saved, whether or not the live game screen is open. Saving
 * is idempotent (recordStat with the tap's id, setStatLocation for a spot, deleteStat for
 * a removal), so a tap saved twice is still one stat.
 */
import { waitAtMost } from '@/lib/wait';
import { listPendingRemovals } from './pendingRemovals';
import { getPendingSpot, listPendingSpots, removePendingSpot } from './pendingSpots';
import {
  hasPendingStats,
  isPendingStat,
  listPendingStats,
  pendingStatSaved,
  removePendingStat,
  retryHeldTaps,
  watchPendingStats,
  type PendingStat,
} from './pendingStats';
import { watchDatabase } from './reopen';
import { deleteStat, getGame, recordStat, setStatLocation } from './repo';
import { sameSpot } from './shots';
import type { StatEvent } from './types';

/**
 * Saves a tap as its stat, with its spot. Idempotent: a tap saved already resolves to
 * its stat, which gets the tap's spot if it doesn't have it (a spot marked after a
 * save that seemed to fail had landed).
 */
export async function savePendingStat(stat: PendingStat): Promise<StatEvent> {
  const event = await recordStat(stat.gameId, stat.type, stat.location, {
    id: stat.id,
    at: stat.at,
    period: stat.period,
  });
  if (!stat.location || sameSpot(event.location, stat.location)) return event;
  return (await setStatLocation(event.id, stat.location)) ?? event;
}

export interface ReplayResult {
  /**
   * Saved (or found saved already) and forgotten: taps, spots put on their stats, and
   * stats of taps taken back, removed.
   */
  saved: number;
  /**
   * Their game (or, for a spot or a removal, its stat) no longer exists: forgotten without
   * saving.
   */
  dropped: number;
  /** Couldn't be saved: still kept, for next time. */
  failed: number;
}

/**
 * Saves the kept taps: those of a page that closed (or couldn't reach the database)
 * before they were saved, and those this page couldn't save yet; then removes the stats
 * of the taps taken back whose removal was kept (pendingRemovals.ts); then puts the
 * spots kept for saved stats (pendingSpots.ts) on them. The app-wide retry calls it, at
 * app start and again while anything isn't saved, in the background. Each is saved at
 * most once and then forgotten; one that can't be saved stays kept for next time. A tap
 * whose game no longer exists is dropped, and so is a spot or a removal whose stat
 * doesn't (a spot never brings back a deleted stat). Stats can be added to finished
 * games, so their taps are saved too. Never rejects.
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
      // Undone (or saved) meanwhile, e.g. on the live game screen, or the journal can't
      // be read right now: leave it be (still kept, it's tried next time). The save
      // starts right after this check, so an Undo can't slip in between.
      if (isPendingStat(stat.id) !== true) continue;
      const event = await savePendingStat(stat);
      // Forgotten, and the live game screen keeps counting it until it reads it back.
      pendingStatSaved(stat.id, event);
      result.saved += 1;
    } catch {
      result.failed += 1;
    }
  }
  await replayPendingRemovals(result);
  await replayPendingSpots(result);
  return result;
}

/**
 * The replay's second part: removes the stat of each tap taken back whose removal was
 * kept. Not found is done too (no save of it landed, or it was deleted since).
 */
async function replayPendingRemovals(result: ReplayResult): Promise<void> {
  for (const { id } of listPendingRemovals()) {
    try {
      // (Once the stat is gone, or found gone, deleteStat forgets the kept removal.)
      const removed = await deleteStat(id);
      if (removed) result.saved += 1;
      else result.dropped += 1;
    } catch {
      result.failed += 1;
    }
  }
}

/** The replay's last part: puts each kept spot on its stat, or drops it if it's gone. */
async function replayPendingSpots(result: ReplayResult): Promise<void> {
  for (const { id } of listPendingSpots()) {
    // As kept right now: it may have been saved, or moved, on the live game screen.
    const spot = getPendingSpot(id);
    if (!spot) continue;
    try {
      const saved = await setStatLocation(id, spot.location);
      // (Moved again meanwhile: that one is the game screen's to save.)
      if (sameSpot(getPendingSpot(id)?.location, spot.location)) removePendingSpot(id);
      if (saved) result.saved += 1;
      else result.dropped += 1;
    } catch (error) {
      // A spot its stat can never take (it isn't a shot): nothing to keep it for.
      if (error instanceof TypeError) {
        removePendingSpot(id);
        result.dropped += 1;
      } else {
        result.failed += 1;
      }
    }
  }
}

/**
 * Tries once to save every tap (and spot) that isn't saved yet: the kept ones
 * (replayPendingStats), then the ones the tracking sessions hold, kept or not, quietly.
 * Two at once are harmless (saving is idempotent). Never rejects.
 */
export async function retryPendingStats(): Promise<void> {
  // Kept taps first: a session is then told which of its taps they saved
  // (pendingStatSaved), rather than saving them again.
  await replayPendingStats();
  await retryHeldTaps();
}

/** How long preparing an export waits, at most, for the taps not saved yet to be saved. */
export const EXPORT_SAVE_WAIT_MS = 2000;

/**
 * Before an export reads the data (a backup file, the spreadsheet): tries once to save
 * the taps that aren't saved yet (retryPendingStats), so the export has them too. Best
 * effort: it waits `maxWaitMs` at most, so a database that doesn't answer never holds
 * the export up, and a tap it can't save now is left for later. Never rejects.
 */
export function savePendingStatsBeforeExport(maxWaitMs = EXPORT_SAVE_WAIT_MS): Promise<void> {
  return waitAtMost(retryPendingStats(), maxWaitMs);
}

/**
 * How long the app-wide retry waits for one try to finish: past that, it carries on as
 * if it had failed, so a save that never answers can't stop the tries after it.
 */
export const RETRY_TRY_WAIT_MS = 30_000;

/**
 * How long the app-wide retry waits to try again while a tap isn't saved: the first
 * wait, then longer ones, and the last one from then on.
 */
export const PENDING_RETRY_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000];

export interface PendingStatsRetryOptions {
  /** The waits between tries (PENDING_RETRY_DELAYS_MS by default). */
  delaysMs?: readonly number[];
  /** How long to wait for one try (RETRY_TRY_WAIT_MS by default). */
  tryWaitMs?: number;
}

/**
 * Starts the app-wide retry of taps (and spots) that aren't saved yet (main.tsx starts
 * it once, after the first render). It tries at once (what an earlier page kept), then,
 * while anything isn't saved (kept in a journal, or held by a tracking session even if
 * it couldn't be kept), again when the app is shown again, when the connection comes
 * back, when the database is open again after closing for good (reopen.ts) and on a
 * timer that backs off. It stops as soon as nothing is pending, runs
 * whether or not the live game screen is open, and never shows anything: saved stats
 * simply appear. Returns a function that stops it.
 */
export function startPendingStatsRetry({
  delaysMs = PENDING_RETRY_DELAYS_MS,
  tryWaitMs = RETRY_TRY_WAIT_MS,
}: PendingStatsRetryOptions = {}): () => void {
  let stopped = false;
  let busy = false;
  // Asked to try while a try was under way: another one follows it.
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Tries in a row that left something unsaved: how far the timer has backed off.
  let misses = 0;

  const schedule = () => {
    if (stopped || busy || timer !== undefined) return;
    if (!hasPendingStats()) {
      misses = 0;
      return;
    }
    const delay = delaysMs[Math.min(Math.max(misses - 1, 0), delaysMs.length - 1)] ?? 0;
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    busy = true;
    try {
      await waitAtMost(retryPendingStats(), tryWaitMs);
    } finally {
      busy = false;
    }
    if (stopped) return;
    const pending = hasPendingStats();
    if (again) {
      again = false;
      if (pending) return run();
    }
    misses = pending ? misses + 1 : 0;
    schedule();
  };

  const runIfPending = () => {
    if (hasPendingStats()) void run();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') runIfPending();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('online', runIfPending);
  // A tap's save failed (or a tap was left unsaved): make sure a try is coming.
  const unwatch = watchPendingStats(schedule);
  // The database is open again after closing for good (reopen.ts): what failed meanwhile
  // can be saved now.
  const unwatchDatabase = watchDatabase((change) => {
    if (change === 'reopened') runIfPending();
  });
  void run();

  return () => {
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', runIfPending);
    unwatch();
    unwatchDatabase();
  };
}
