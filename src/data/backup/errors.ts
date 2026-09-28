/**
 * What the cloud backup's public API resolves to when something goes wrong: a kind to
 * branch on and a plain message for the parent. Nothing in the public API throws for
 * an expected failure (no signal, a typo in a code, a busy server...).
 */
import type { ApiErrorKind } from './api';
import { SnapshotError, type SnapshotProblem } from './snapshot';

export type CloudBackupErrorKind =
  /** Network and server failures (see ApiErrorKind in api.ts). */
  | ApiErrorKind
  /** A downloaded backup that can't be restored (see SnapshotError). */
  | SnapshotProblem
  /** Not a well-formed backup code (a typo, wrong length...). */
  | 'invalid-code'
  /** This build has no backup server configured, or the browser lacks WebCrypto. */
  | 'unavailable'
  /** Cloud backup is off. */
  | 'not-enabled'
  /** Held back by the shrink guard: back up with `force: true` to upload anyway. */
  | 'shrink'
  /** A bug, or the phone's storage failed. */
  | 'unexpected';

export interface CloudBackupError {
  kind: CloudBackupErrorKind;
  /** Written for the parent to read. */
  message: string;
  /** How long the server asked us to wait, for 'rate-limited' and 'server-busy'. */
  retryAfterMs?: number;
}

export type CloudResult<T> = { ok: true; value: T } | { ok: false; error: CloudBackupError };

/** What was being done: the same failure reads differently for each. */
export type ErrorContext = 'backup' | 'restore' | 'delete';

const COMMON: Partial<Record<CloudBackupErrorKind, string>> = {
  unavailable: "Cloud backup isn't available in this version of Hoop Stats.",
  'not-enabled': 'Cloud backup is off.',
  aborted: 'Stopped before it finished.',
};

const BACKUP: Partial<Record<CloudBackupErrorKind, string>> = {
  offline:
    "No internet connection. Your stats are safe on this phone and will back up when you're online.",
  network:
    "Couldn't reach the backup server. Your stats are safe on this phone, and Hoop Stats will try again soon.",
  timeout: 'The backup server took too long to answer. Hoop Stats will try again soon.',
  unauthorized:
    "The backup server doesn't accept this backup code anymore. Turn cloud backup off and on again to get a new code.",
  'account-deleted':
    'Your cloud backup was deleted, so automatic backup stopped. Back up now to start a new one.',
  'too-large': 'Your stats are too big for cloud backup. Save a backup file instead.',
  'rate-limited': 'The backup server is busy. Hoop Stats will try again in a few minutes.',
  'server-busy': 'The backup server is busy. Hoop Stats will try again in a few minutes.',
  'server-full':
    'The backup server is out of space. Your stats are safe on this phone, and Hoop Stats will keep trying.',
  'account-limit':
    "The backup server is full, so it can't take a new backup. Ask whoever set it up to make room.",
  shrink:
    'This phone has much less data than your last backup, so automatic backup is paused to keep that backup safe.',
  'invalid-code':
    'The backup code saved on this phone is damaged. Turn cloud backup off and on again to get a new code.',
};
const BACKUP_FALLBACK = 'The backup server had a problem. Hoop Stats will try again soon.';

const RESTORE: Partial<Record<CloudBackupErrorKind, string>> = {
  offline: 'No internet connection. Connect, then try again.',
  network: "Couldn't reach the backup server. Check your connection, then try again.",
  timeout: 'The backup server took too long to answer. Try again in a minute.',
  unauthorized: "There's no backup for this code. Check the code and try again.",
  'not-found': "There's no backup saved with this code yet.",
  'rate-limited': 'The backup server is busy. Try again in a minute.',
  'server-busy': 'The backup server is busy. Try again in a minute.',
};
const RESTORE_FALLBACK = 'The backup server had a problem. Try again later.';

const DELETE: Partial<Record<CloudBackupErrorKind, string>> = {
  offline:
    "No internet connection, so your cloud backup wasn't deleted. Try again when you're online.",
  network:
    "Couldn't reach the backup server, so your cloud backup wasn't deleted. Try again later.",
  timeout:
    "The backup server took too long to answer, so your cloud backup wasn't deleted. Try again later.",
  'rate-limited':
    "The backup server is busy, so your cloud backup wasn't deleted. Try again in a minute.",
  'server-busy':
    "The backup server is busy, so your cloud backup wasn't deleted. Try again in a minute.",
};
const DELETE_FALLBACK = "The backup server couldn't delete your cloud backup. Try again later.";

/** The parent-facing message for a failure of `kind` while doing `context`. */
export function errorMessage(kind: CloudBackupErrorKind, context: ErrorContext): string {
  const [messages, fallback] =
    context === 'backup'
      ? [BACKUP, BACKUP_FALLBACK]
      : context === 'restore'
        ? [RESTORE, RESTORE_FALLBACK]
        : [DELETE, DELETE_FALLBACK];
  if (kind in messages) return messages[kind] ?? fallback;
  if (kind in COMMON) return COMMON[kind] ?? fallback;
  // A downloaded backup that can't be read explains itself.
  if (isSnapshotProblem(kind)) return new SnapshotError(kind).message;
  return fallback;
}

function isSnapshotProblem(kind: CloudBackupErrorKind): kind is SnapshotProblem {
  return (
    kind === 'wrong-code' ||
    kind === 'damaged' ||
    kind === 'newer-version' ||
    kind === 'unsupported'
  );
}

export interface ErrorDetails {
  /** Overrides the standard message for `kind`. */
  message?: string;
  retryAfterMs?: number;
}

export function cloudError(
  kind: CloudBackupErrorKind,
  context: ErrorContext,
  details: ErrorDetails = {},
): CloudBackupError {
  const error: CloudBackupError = { kind, message: details.message ?? errorMessage(kind, context) };
  if (details.retryAfterMs !== undefined) error.retryAfterMs = details.retryAfterMs;
  return error;
}

/** A failed CloudResult. */
export function cloudFailure<T>(
  kind: CloudBackupErrorKind,
  context: ErrorContext,
  details: ErrorDetails = {},
): CloudResult<T> {
  return { ok: false, error: cloudError(kind, context, details) };
}
