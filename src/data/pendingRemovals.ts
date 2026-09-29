/**
 * The pending-removals journal: taps the live game screen took back (Undo, or the log)
 * whose stat may be saved and isn't confirmed removed yet, kept in localStorage so that
 * a reload still removes it.
 *
 * Taking back a tap forgets its pending-stats entry at once (pendingStats.ts), so nothing
 * saves it again. But a save of it may have landed (even one that seemed to fail), so its
 * stat is removed by id too, and while the database can't be written (WebKit lost its
 * connection) that removal keeps failing. Kept here, it's finished after a reload too:
 * replayPendingStats() (pendingSaves.ts) deletes each kept stat, at app start and with
 * every try of the app-wide retry (not found counts as done), and a game's tracking
 * session starts with its game's, not counting them, and removes them itself.
 *
 * A tap is kept here from the Undo on, even while a save of it is under way: IndexedDB
 * runs that earlier save before any later delete (this page's, or the next page's after
 * a reload), so no save can land after its stat was found gone.
 *
 * One key per stat, `hoop-stats.pendingRemoval.<id>`, holding the tap as it was kept
 * (`{ id, gameId, type, period, at }`). Nothing here throws: without localStorage, a
 * removal still happens, just not across a reload (and the live game screen doesn't
 * offer Reload meanwhile). Deleting or replacing data forgets these too
 * (forgetPendingStats in pendingStats.ts), so no later restore loses a stat to one.
 */
import { compareIds } from '@/lib/id';
import { removeJournalEntries, type RemovedEntries } from './journal';
import type { StatType } from './types';
import { statEventSchema } from './validation';

/** A tap taken back whose stat may still have to be removed. */
export interface PendingRemoval {
  /** Its stat's id. */
  id: string;
  gameId: string;
  type: StatType;
  /** The period on screen at the tap. */
  period: number;
  /** When it was tapped (epoch ms). */
  at: number;
}

const KEY_PREFIX = 'hoop-stats.pendingRemoval.';

/**
 * Keeps a tap taken back until its stat is confirmed removed. Returns false if it
 * couldn't be kept (no localStorage, or it's full).
 */
export function addPendingRemoval(removal: PendingRemoval): boolean {
  const { id, gameId, type, period, at } = removal;
  try {
    localStorage.setItem(KEY_PREFIX + id, JSON.stringify({ id, gameId, type, period, at }));
    return true;
  } catch {
    return false;
  }
}

/** Forgets a kept removal: its stat is gone (or stays after all). */
export function removePendingRemoval(id: string): void {
  try {
    localStorage.removeItem(KEY_PREFIX + id);
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
}

/** One entry, or undefined if it isn't one this version can read. */
function parseEntry(key: string, text: string | null): PendingRemoval | undefined {
  if (text === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, gameId, type, period, at } = value as Record<string, unknown>;
  const checked = statEventSchema.safeParse({ id, gameId, type, period, createdAt: at });
  if (!checked.success || key !== KEY_PREFIX + checked.data.id) return undefined;
  return {
    id: checked.data.id,
    gameId: checked.data.gameId,
    type: checked.data.type,
    period: checked.data.period,
    at: checked.data.createdAt,
  };
}

/**
 * The kept removals, in tap order: all of them, or one game's. An entry this version
 * can't read is skipped but left alone.
 */
export function listPendingRemovals(gameId?: string): PendingRemoval[] {
  const removals: PendingRemoval[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      const removal = parseEntry(key, localStorage.getItem(key));
      if (removal && (gameId === undefined || removal.gameId === gameId)) removals.push(removal);
    }
  } catch {
    // Blocked storage: nothing could have been kept there.
  }
  return removals.sort((a, b) => a.at - b.at || compareIds(a.id, b.id));
}

/**
 * Forgets the kept removals of one game, or of every game (then every entry, even one
 * this version can't read). For writes that delete or replace data, through
 * forgetPendingStats (pendingStats.ts). Says how to keep them again if the write fails.
 */
export function forgetPendingRemovals(gameId?: string): RemovedEntries {
  return removeJournalEntries(KEY_PREFIX, gameId);
}
