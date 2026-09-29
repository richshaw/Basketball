/**
 * The cloud backup's status for the UI, worked out from the stored state, what the
 * scheduler is doing right now and, for the shrink guard, the games on the phone (pure;
 * see useCloudBackupStatus in hooks.ts).
 */
import { hasUnsavedChanges, isConnectionProblem, shrinkCheck, type RealData } from './policy';
import { isBackupOn, type BackupErrorInfo, type StoredBackupState } from './state';

/**
 * - 'idle': nothing to report (off, all backed up, or waiting for its next turn);
 * - 'backing-up': an upload is running;
 * - 'waiting-for-signal': there are changes to back up, but no connection;
 * - 'needs-attention': automatic backup stopped until the parent acts (see `lastError`:
 *   the code was rejected, the cloud copy was deleted, or the data is too big);
 * - 'paused-shrink': held back because games in the last backup aren't on the phone
 *   (`shrink` says how many); `backUpNow({ force: true })` uploads anyway, and it
 *   resumes by itself once they're back (e.g. after a restore);
 * - 'paused-other-device': another phone uploaded under this code since this one did
 *   (`otherDevice` says when); restore its backup, or `backUpNow({ force: true })`;
 * - 'error': the last attempt failed; it's retried at `nextAttemptAt`.
 */
export type CloudBackupStatusState =
  | 'idle'
  | 'backing-up'
  | 'waiting-for-signal'
  | 'needs-attention'
  | 'paused-shrink'
  | 'paused-other-device'
  | 'error';

export interface CloudBackupStatus {
  /** This build can back up (a server is configured and the browser has WebCrypto). */
  available: boolean;
  /** Cloud backup is on. (Off, the phone may still keep its code: see getBackupCode.) */
  enabled: boolean;
  state: CloudBackupStatusState;
  /** When the last upload from this phone succeeded (epoch ms). */
  lastSuccessAt?: number;
  /** The last failure, with a message for the parent; cleared by a successful upload. */
  lastError?: BackupErrorInfo;
  /** When the next automatic retry is due, after a failure (epoch ms). */
  nextAttemptAt?: number;
  /** The phone has changes that aren't in the cloud yet. */
  pendingChanges: boolean;
  /** For 'paused-shrink': real games in the last backup, and how many of them are missing. */
  shrink?: { backedUpGames: number; missingGames: number };
  /** For 'paused-other-device': when the other phone's backup was uploaded (epoch ms). */
  otherDevice?: { backedUpAt?: number };
}

/** What the scheduler is doing in this window (not stored). */
export interface BackupRuntime {
  uploading: boolean;
  /** The running attempt overrides the pause shown ("Back up anyway"). */
  forced?: boolean;
  online: boolean;
}

export interface StatusInputs {
  available: boolean;
  stored: StoredBackupState | undefined;
  /** `meta.lastChangeAt`. */
  lastChangeAt: number | undefined;
  /**
   * The parent's own games and stats on the phone now (see realData), read when the next
   * automatic upload would run the shrink guard on them (see checksShrink): then the
   * status shows its pause as soon as the data calls for one (see shownBackupState).
   */
  current?: RealData;
  runtime: BackupRuntime;
}

/**
 * Whether the next automatic upload would run the shrink guard on the data as it is
 * now: backup is on and paused for nothing else (any other pause stops automatic
 * uploads first), there are changes to upload, and the guard hasn't looked at this very
 * data already. The engine's automatic attempts go by it too (see tryUpload), so the
 * status and the engine can't disagree. A plain boolean, not a type guard: a state it
 * says no to can still be a backup that's on.
 */
export function checksShrink(
  stored: StoredBackupState | undefined,
  lastChangeAt: number | undefined,
): boolean {
  if (!isBackupOn(stored)) return false;
  if (stored.paused !== undefined && stored.paused !== 'shrink') return false;
  if (stored.paused === 'shrink' && stored.shrink?.changeAt === lastChangeAt) return false;
  return hasUnsavedChanges(stored, lastChangeAt);
}

/**
 * The stored state with the shrink guard's pause as the data calls for it now, so the
 * status doesn't wait for the next upload attempt to find it: paused as soon as that
 * attempt would be held back (after "Erase all data", say), and no longer paused once
 * the missing games are back (that attempt then uploads, which clears the pause). It
 * only changes what's shown: the engine stores a pause when an attempt is held back.
 */
export function shownBackupState(
  stored: StoredBackupState,
  lastChangeAt: number | undefined,
  current: RealData | undefined,
): StoredBackupState {
  if (current === undefined || !checksShrink(stored, lastChangeAt)) return stored;
  const finding = shrinkCheck(stored, current);
  if (finding) return { ...stored, paused: 'shrink', shrink: finding };
  if (stored.paused !== 'shrink') return stored;
  const { paused: _paused, shrink: _shrink, lastError, ...rest } = stored;
  return lastError && lastError.kind !== 'shrink' ? { ...rest, lastError } : rest;
}

/**
 * Pauses that every attempt checks again unless it's forced: an attempt made while one is
 * shown (an automatic one after a change, say) is held again, so the pause stays on
 * screen instead of blinking to "backing up" and back.
 */
function rechecksPause(paused: StoredBackupState['paused']): boolean {
  return paused === 'shrink' || paused === 'other-device';
}

function activity(
  stored: StoredBackupState,
  pendingChanges: boolean,
  runtime: BackupRuntime,
): CloudBackupStatusState {
  if (runtime.uploading && (runtime.forced || !rechecksPause(stored.paused))) {
    return 'backing-up';
  }
  if (stored.paused === 'shrink') return 'paused-shrink';
  if (stored.paused === 'other-device') return 'paused-other-device';
  if (stored.paused) return 'needs-attention';
  if (pendingChanges && !runtime.online) return 'waiting-for-signal';
  if (stored.lastError) {
    return isConnectionProblem(stored.lastError.kind) ? 'waiting-for-signal' : 'error';
  }
  return 'idle';
}

export function deriveStatus({
  available,
  stored: storedState,
  lastChangeAt,
  current,
  runtime,
}: StatusInputs): CloudBackupStatus {
  if (!available || !isBackupOn(storedState)) {
    return { available, enabled: false, state: 'idle', pendingChanges: false };
  }
  const stored = shownBackupState(storedState, lastChangeAt, current);
  const pendingChanges = hasUnsavedChanges(stored, lastChangeAt);
  const status: CloudBackupStatus = {
    available,
    enabled: true,
    state: activity(stored, pendingChanges, runtime),
    pendingChanges,
  };
  if (stored.lastSuccessAt !== undefined) status.lastSuccessAt = stored.lastSuccessAt;
  if (stored.lastError) status.lastError = stored.lastError;
  if (stored.nextAttemptAt !== undefined) status.nextAttemptAt = stored.nextAttemptAt;
  if (stored.paused === 'shrink' && stored.shrink) {
    status.shrink = {
      backedUpGames: stored.shrink.backedUpGames,
      missingGames: stored.shrink.missingGames,
    };
  }
  if (stored.paused === 'other-device') {
    const backedUpAt = stored.otherDevice?.createdAt;
    status.otherDevice = backedUpAt === undefined ? {} : { backedUpAt };
  }
  return status;
}
