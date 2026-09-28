/**
 * The cloud backup's rules, as pure functions: when to upload, how long to wait
 * after a failure, and when a snapshot looks like it would lose games from the backup.
 */
import { isDemoGameId } from '../demo';
import type { ExportFile } from '../transfer';
import type { ApiErrorKind } from './api';
import type { PauseReason, StoredBackupState } from './state';

export interface BackupTimings {
  /** Wait after the app starts before the first check, so startup stays quick. */
  startupDelayMs: number;
  /** Quiet time after the last change before uploading. */
  debounceMs: number;
  /** ...but never more than this after the first change that isn't backed up yet. */
  maxWaitMs: number;
  /**
   * The same while a game is live. Taps keep coming, and an upload competes with them
   * for the database, so a live game uploads in a quiet spell (after `debounceMs`
   * without a tap), and only this long after a change when there's none.
   */
  liveGameMaxWaitMs: number;
  /** Least time between the starts of two automatic uploads. */
  minIntervalMs: number;
  /** The same while a game is live. */
  liveGameMinIntervalMs: number;
  /** Wait after a game ends before backing it up. */
  gameEndDelayMs: number;
  /** Wait after the 1st, 2nd, 3rd… failure in a row; the last one repeats. */
  retryDelaysMs: readonly number[];
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const DEFAULT_TIMINGS: Readonly<BackupTimings> = Object.freeze({
  startupDelayMs: 3 * SECOND,
  debounceMs: 20 * SECOND,
  maxWaitMs: 60 * SECOND,
  liveGameMaxWaitMs: 5 * MINUTE,
  minIntervalMs: 10 * SECOND,
  liveGameMinIntervalMs: 60 * SECOND,
  gameEndDelayMs: 2 * SECOND,
  retryDelaysMs: Object.freeze([1, 2, 5, 15, 30].map((minutes) => minutes * MINUTE)),
});

/**
 * How long to wait after `failures` failed attempts in a row (1 or more): the
 * backoff step, or longer if the server asked (Retry-After).
 */
export function retryDelayMs(
  failures: number,
  retryAfterMs: number | undefined,
  timings: Pick<BackupTimings, 'retryDelaysMs'> = DEFAULT_TIMINGS,
): number {
  const steps = timings.retryDelaysMs;
  const step = steps[Math.min(Math.max(failures, 1), steps.length) - 1] ?? 0;
  return Math.max(step, retryAfterMs ?? 0);
}

/**
 * The parent's own data in an export: the games that aren't sample data, and their
 * stats. Sample games come and go ("Try it with sample data", "Remove sample games"),
 * so the shrink guard never counts them.
 */
export interface RealData {
  gameIds: string[];
  events: number;
}

export function realData(file: Pick<ExportFile, 'games' | 'events'>): RealData {
  const gameIds = file.games.map((game) => game.id).filter((id) => !isDemoGameId(id));
  const real = new Set(gameIds);
  return { gameIds, events: file.events.filter((event) => real.has(event.gameId)).length };
}

export interface ShrinkFinding {
  /** Real games in the backup. */
  backedUpGames: number;
  /** How many of them this phone no longer has. */
  missingGames: number;
}

/**
 * The shrink guard: whether uploading `current` would drop games (or stats) from the
 * backup, which is far more likely an accident ("Erase all data", a phone that wasn't
 * restored) than what the parent wants. It compares the games themselves, by id, so
 * new games never make up for missing ones. Held back when:
 * - at least 3 of the backup's games, and at least half of them, aren't on the phone;
 * - none of them is (however few there were); or
 * - the backup had stats and the phone has none.
 * Resolves to what's missing, or undefined when the upload may go ahead.
 */
export function shrinkCheck(
  backedUp: Pick<StoredBackupState, 'backedUpGameIds' | 'backedUpEventCount'>,
  current: RealData,
): ShrinkFinding | undefined {
  const ids = backedUp.backedUpGameIds ?? [];
  const onPhone = new Set(current.gameIds);
  const missing = ids.filter((id) => !onPhone.has(id)).length;
  const lostMany = missing >= 3 && missing * 2 >= ids.length;
  const lostAll = ids.length > 0 && missing === ids.length;
  const lostStats = (backedUp.backedUpEventCount ?? 0) > 0 && current.events === 0;
  return lostMany || lostAll || lostStats
    ? { backedUpGames: ids.length, missingGames: missing }
    : undefined;
}

/**
 * Whether the phone has changes the cloud doesn't. `lastChangeAt` is
 * `meta.lastChangeAt`; undefined means the data has never changed, which still needs
 * one first upload.
 */
export function hasUnsavedChanges(
  state: Pick<StoredBackupState, 'lastUploadedChangeAt' | 'lastSuccessAt'>,
  lastChangeAt: number | undefined,
): boolean {
  if (lastChangeAt === undefined) return state.lastSuccessAt === undefined;
  return state.lastUploadedChangeAt === undefined || lastChangeAt > state.lastUploadedChangeAt;
}

/**
 * Upload failures that retrying can't fix, so automatic backup stops until the parent
 * acts. Anything else is retried with backoff.
 */
export function pauseReasonFor(kind: ApiErrorKind): PauseReason | undefined {
  switch (kind) {
    case 'unauthorized':
      return 'code-rejected';
    case 'account-deleted':
      return 'cloud-deleted';
    case 'too-large':
      return 'too-large';
    default:
      return undefined;
  }
}

/** Failures that mean "no connection" rather than a server problem. */
export function isConnectionProblem(kind: string): boolean {
  return kind === 'offline' || kind === 'network' || kind === 'timeout';
}
