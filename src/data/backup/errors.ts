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
  /** Another phone uploaded under this code since this one did: `force: true` overrides. */
  | 'other-device'
  /** Something failed on this phone (its storage, WebCrypto or gzip), or a bug. */
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

const MINUTE = 60_000;

/** "in a minute", "in 5 minutes", "in 3 hours", "in 2 days": never sooner than `ms`. */
export function describeWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  if (minutes === 1) return 'in a minute';
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  if (hours === 1) return 'in an hour';
  if (hours < 48) return `in ${hours} hours`;
  return `in ${Math.ceil(hours / 24)} days`;
}

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
  'server-full':
    'The backup server is out of space. Your stats are safe on this phone, and Hoop Stats will keep trying.',
  'account-limit':
    "The backup server is full, so it can't take a new backup. Ask whoever set it up to make room.",
  shrink:
    "Some games in your last backup aren't on this phone, so automatic backup is paused to keep that backup safe.",
  'other-device':
    'Another phone has backed up with this backup code since this phone did, so this phone stopped backing up to keep from replacing that backup.',
  unexpected:
    'Something went wrong on this phone while backing up. Your stats are safe, and Hoop Stats will try again soon.',
};
const BACKUP_FALLBACK = 'The backup server had a problem. Hoop Stats will try again soon.';

const RESTORE: Partial<Record<CloudBackupErrorKind, string>> = {
  offline: 'No internet connection. Connect, then try again.',
  network: "Couldn't reach the backup server. Check your connection, then try again.",
  timeout: 'The backup server took too long to answer. Try again in a minute.',
  unauthorized: "There's no backup for this code. Check the code and try again.",
  'not-found': "There's no backup saved with this code yet.",
  unexpected: 'Something went wrong on this phone. Try again.',
};
const RESTORE_FALLBACK = 'The backup server had a problem. Try again later.';

const DELETE: Partial<Record<CloudBackupErrorKind, string>> = {
  offline:
    "No internet connection, so your cloud backup wasn't deleted. Try again when you're online.",
  network:
    "Couldn't reach the backup server, so your cloud backup wasn't deleted. Try again later.",
  timeout:
    "The backup server took too long to answer, so your cloud backup wasn't deleted. Try again later.",
  unexpected: 'Something went wrong on this phone, so cloud backup is still on. Try again.',
};
const DELETE_FALLBACK = "The backup server couldn't delete your cloud backup. Try again later.";

/** A busy server's message, with the real wait when it's known. */
function busyMessage(context: ErrorContext, waitMs: number | undefined): string {
  switch (context) {
    case 'backup':
      return `The backup server is busy. Hoop Stats will try again ${
        waitMs === undefined ? 'in a few minutes' : describeWait(waitMs)
      }.`;
    case 'restore':
      return `The backup server is busy. Try again ${describeWait(waitMs ?? MINUTE)}.`;
    case 'delete':
      return `The backup server is busy, so your cloud backup wasn't deleted. Try again ${describeWait(
        waitMs ?? MINUTE,
      )}.`;
  }
}

/**
 * The parent-facing message for a failure of `kind` while doing `context`. `waitMs`
 * is when it will be (or can be) tried again, for a busy server.
 */
export function errorMessage(
  kind: CloudBackupErrorKind,
  context: ErrorContext,
  waitMs?: number,
): string {
  if (kind === 'rate-limited' || kind === 'server-busy') return busyMessage(context, waitMs);
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
  /** When it will be tried again, if not `retryAfterMs` (see errorMessage). */
  waitMs?: number;
}

export function cloudError(
  kind: CloudBackupErrorKind,
  context: ErrorContext,
  details: ErrorDetails = {},
): CloudBackupError {
  const message =
    details.message ?? errorMessage(kind, context, details.waitMs ?? details.retryAfterMs);
  const error: CloudBackupError = { kind, message };
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
