/**
 * Saving the taps kept in the pending-stats journal (pendingStats.ts) into the
 * database: one tap (savePendingStat), or every kept tap (replayPendingStats). Saving
 * is idempotent (recordStat with the tap's id), so a tap saved twice is still one stat.
 */
import {
  isPendingStat,
  listPendingStats,
  removePendingStat,
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
