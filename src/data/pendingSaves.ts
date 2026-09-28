/**
 * Saving the taps that aren't saved yet into the database: one kept tap
 * (savePendingStat), every kept tap (replayPendingStats), and the app-wide retry
 * (startPendingStatsRetry), which keeps trying while any tap isn't saved, whether or
 * not the live game screen is open. Saving is idempotent (recordStat with the tap's
 * id), so a tap saved twice is still one stat.
 */
import {
  hasPendingStats,
  isPendingStat,
  listPendingStats,
  removePendingStat,
  retryHeldTaps,
  watchPendingStats,
  type PendingStat,
} from './pendingStats';
import { getGame, recordStat } from './repo';
import type { StatEvent } from './types';

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

/**
 * Tries once to save every tap that isn't saved yet: the kept ones (replayPendingStats),
 * then the ones the tracking sessions hold, kept or not, quietly. Two at once are
 * harmless (saving is idempotent). Never rejects.
 */
export async function retryPendingStats(): Promise<void> {
  // Kept taps first: a session then drops a kept tap saved meanwhile, rather than
  // saving it again.
  await replayPendingStats();
  await retryHeldTaps();
}

/** Waits for `task` (which never rejects), but no longer than `ms`: it carries on unwatched. */
async function waitAtMost(task: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    task,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
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
 * Starts the app-wide retry of taps that aren't saved yet (main.tsx starts it once,
 * after the first render). It tries at once (taps an earlier page kept), then, while
 * any tap isn't saved (kept in the journal, or held by a tracking session even if it
 * couldn't be kept), again when the app is shown again, when the connection comes back
 * and on a timer that backs off. It stops as soon as nothing is pending, runs whether
 * or not the live game screen is open, and never shows anything: saved stats simply
 * appear. Returns a function that stops it.
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
  void run();

  return () => {
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('online', runIfPending);
    unwatch();
  };
}
