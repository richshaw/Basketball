/**
 * The cloud backup's status for the UI, worked out from the stored state and what
 * the scheduler is doing right now (pure; see useCloudBackupStatus in hooks.ts).
 */
import { hasUnsavedChanges, isConnectionProblem } from './policy';
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
  online: boolean;
}

export interface StatusInputs {
  available: boolean;
  stored: StoredBackupState | undefined;
  /** `meta.lastChangeAt`. */
  lastChangeAt: number | undefined;
  runtime: BackupRuntime;
}

function activity(
  stored: StoredBackupState,
  pendingChanges: boolean,
  runtime: BackupRuntime,
): CloudBackupStatusState {
  if (runtime.uploading) return 'backing-up';
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
  stored,
  lastChangeAt,
  runtime,
}: StatusInputs): CloudBackupStatus {
  if (!available || !isBackupOn(stored)) {
    return { available, enabled: false, state: 'idle', pendingChanges: false };
  }
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
