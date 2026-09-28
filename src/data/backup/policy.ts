/**
 * The cloud backup's rules, as pure functions: when to upload, how long to wait
 * after a failure, and when a snapshot looks too small to upload on its own.
 */
import type { ApiErrorKind } from './api';
import type { PauseReason, StoredBackupState } from './state';

export interface BackupTimings {
  /** Wait after the app starts before the first check, so startup stays quick. */
  startupDelayMs: number;
  /** Quiet time after the last change before uploading. */
  debounceMs: number;
  /** ...but never more than this after the first change that isn't backed up yet. */
  maxWaitMs: number;
  /** Least time between the starts of two automatic uploads. */
  minIntervalMs: number;
  /** The same while a game is live (at most one upload a minute). */
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

/** What's on the phone, or in an upload. */
export interface DataSize {
  games: number;
  events: number;
}

/**
 * The shrink guard: whether uploading `current` would replace a backup of `backedUp`
 * with much less, which is far more likely an accident ("Erase all data", a broken
 * restore) than what the parent wants. True when:
 * - the backup had games and the phone has none;
 * - at least 3 games and at least half of them are gone; or
 * - the backup had stats and every one is gone while games remain.
 */
export function isMuchSmaller(backedUp: Partial<DataSize>, current: DataSize): boolean {
  const games = backedUp.games ?? 0;
  const events = backedUp.events ?? 0;
  if (games > 0 && current.games === 0) return true;
  if (games - current.games >= 3 && current.games * 2 <= games) return true;
  return events > 0 && current.events === 0 && current.games > 0;
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
