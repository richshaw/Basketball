/**
 * The pending-periods journal: the period the live game screen moved to (Next, the
 * period sheet, or a move's Undo) until that move is confirmed saved, kept in
 * localStorage so it outlives the page. Without it, a reload while the database doesn't
 * answer would bring back the saved period, silently, and every tap after it would go
 * into the wrong period.
 *
 * Each move is kept here before its IndexedDB write starts, and forgotten once the saved
 * game shows its period. A game's tracking session starts on the period kept for its
 * game, and saves it; replayPendingStats() (pendingSaves.ts) saves it too, at app start
 * and with every try of the app-wide retry.
 *
 * One key per game, `hoop-stats.pendingPeriod.<gameId>`, holding the game's latest move
 * not confirmed saved, `{ id, gameId, period }`: each move has an id of its own and
 * replaces the one kept before it, in whichever tab or page it's made. So what's kept is
 * always the move to make, and a kept move never overrides a move made since: a write of
 * a move checks, as it runs, that it's still the kept one (setCurrentPeriod's `onlyIf`),
 * and a move is forgotten only while it's still the kept one. Nothing here throws:
 * without localStorage, a move is still saved, just not kept across a reload.
 */
import { newId } from '@/lib/id';
import {
  listJournalEntries,
  parseJournalEntry,
  removeJournalEntries,
  removeJournalEntry,
  writeJournalEntry,
  type RemovedEntries,
} from './journal';
import { MAX_PERIOD } from './types';
import { MAX_ID_LENGTH } from './validation';

/** A move to another period that isn't confirmed saved yet. */
export interface PendingPeriod {
  /** This move's own id: a move made since has another. */
  id: string;
  gameId: string;
  /** The period moved to. */
  period: number;
}

const KEY_PREFIX = 'hoop-stats.pendingPeriod.';

/** A new move of a game to `period`. */
export function newPendingPeriod(gameId: string, period: number): PendingPeriod {
  return { id: newId(), gameId, period };
}

/**
 * Keeps a move until it's saved, in place of the game's move kept before it: call it
 * before its write starts. Returns false if it couldn't be kept (no localStorage, or
 * it's full); then the move kept before it is forgotten too, as it would override this
 * one.
 */
export function keepPendingPeriod(move: PendingPeriod): boolean {
  const { id, gameId, period } = move;
  if (writeJournalEntry(KEY_PREFIX + gameId, { id, gameId, period })) return true;
  removeJournalEntry(KEY_PREFIX + gameId);
  return false;
}

/** One entry, or undefined if it isn't a move this version can save. */
function parseEntry(key: string, text: string | null): PendingPeriod | undefined {
  const value = parseJournalEntry(text);
  if (!value) return undefined;
  const { id, gameId, period } = value;
  if (typeof id !== 'string' || !id || id.length > MAX_ID_LENGTH) return undefined;
  if (typeof gameId !== 'string' || !gameId || key !== KEY_PREFIX + gameId) return undefined;
  if (typeof period !== 'number' || !Number.isInteger(period)) return undefined;
  if (period < 1 || period > MAX_PERIOD) return undefined;
  return { id, gameId, period };
}

/** The move kept for a game, if any (none when localStorage can't be read right now). */
export function getPendingPeriod(gameId: string): PendingPeriod | undefined {
  try {
    return parseEntry(KEY_PREFIX + gameId, localStorage.getItem(KEY_PREFIX + gameId));
  } catch {
    return undefined;
  }
}

/** Whether `move` is still its game's kept move: no move was made since, nor saved. */
export function isPendingPeriod(move: Pick<PendingPeriod, 'id' | 'gameId'>): boolean {
  return getPendingPeriod(move.gameId)?.id === move.id;
}

/** Forgets a move once its period is saved, unless a move made since has taken its place. */
export function forgetPendingPeriod(move: Pick<PendingPeriod, 'id' | 'gameId'>): void {
  if (isPendingPeriod(move)) removeJournalEntry(KEY_PREFIX + move.gameId);
}

/**
 * The kept moves: every game's, or one game's (one at most). An entry this version can't
 * read is skipped but left alone.
 */
export function listPendingPeriods(gameId?: string): PendingPeriod[] {
  return listJournalEntries(KEY_PREFIX, parseEntry, gameId);
}

/**
 * Forgets the moves kept for one game, or for every game (then every entry, even one this
 * version can't read). For writes that delete or replace data, through
 * forgetPendingStats (pendingStats.ts): no move may be saved into a game restored or
 * made again under the same id afterwards. Says how to keep them again if the write
 * fails.
 */
export function forgetPendingPeriods(gameId?: string): RemovedEntries {
  return removeJournalEntries(KEY_PREFIX, gameId);
}
