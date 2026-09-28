/**
 * Cloud backup: the public API for screens (the status hook is in ./hooks.ts).
 *
 * The app keeps an end-to-end-encrypted copy of all its data on the project's backup
 * server (server/). It's opt-in: turning it on makes a backup code, the one secret
 * that can read or restore the backups, which the parent must write down. From then
 * on the scheduler (started by main.tsx) uploads a new snapshot whenever the data
 * changes and there's signal. On a new phone, the code brings the data back.
 *
 * Everything here resolves to a `CloudResult` with a message for the parent instead
 * of throwing, except where noted. See CLAUDE.md, "Cloud backup".
 */
import type { BackupVersion } from './api';
import { backupApiUrl } from './config';
import { BackupEngine, type BackupResult, type CloudBackup } from './engine';
import type { CloudResult } from './errors';
import type { BackupTimings } from './policy';
import type { BackupRuntime, CloudBackupStatus } from './status';

export type { BackupVersion } from './api';
export type { BackupResult, CloudBackup } from './engine';
export type { CloudBackupError, CloudBackupErrorKind, CloudResult } from './errors';
export type { CloudBackupStatus, CloudBackupStatusState } from './status';

/** The app's one engine. It does nothing until started or asked. */
const engine = new BackupEngine({ apiUrl: backupApiUrl });

/** Whether this build can back up: a backup server is configured and WebCrypto works. */
export function isCloudBackupAvailable(): boolean {
  return engine.isAvailable();
}

/**
 * Starts automatic backup (main.tsx calls it once at startup). Idempotent, and does
 * nothing in a build without a backup server. Uploads only happen while backup is on.
 */
export function startBackupScheduler(): void {
  engine.start();
}

/** Stops automatic backup (for tests). */
export function stopBackupScheduler(): void {
  engine.stop();
}

/**
 * Turns cloud backup on and starts an upload (watch `useCloudBackupStatus()` for its
 * progress). Resolves to the backup code to show the parent: the code this phone kept
 * when backup was turned off, if any (same code, same cloud copy), else a new one. If
 * backup is already on, the current code. Rejects only if cloud backup isn't
 * available (check isCloudBackupAvailable first) or storage fails.
 */
export function enableCloudBackup(): Promise<string> {
  return engine.enable();
}

export interface EnableWithCodeOptions {
  /** `fetchCloudBackup(code)`'s result, so it isn't downloaded again. */
  backup?: CloudBackup;
}

/**
 * Turns cloud backup on with an existing code, after restoring from it on this phone
 * (importAll), and starts an upload. The code must have a backup on the server: the
 * restored backup's games become the shrink guard's baseline, so a phone without them
 * can't replace it by accident, and the phone carries on from the server's newest
 * version (so restoring an earlier one isn't taken for another phone's upload).
 * Replaces any other code this phone had (on or kept while off); if it's on with this
 * code already (restoring the other phone's backup to settle a 'paused-other-device',
 * say), it carries on from the restored backup with nothing paused.
 */
export function enableCloudBackupWithCode(
  code: string,
  options: EnableWithCodeOptions = {},
): Promise<CloudResult<void>> {
  return engine.enableWithCode(code, options);
}

export interface DisableOptions {
  /** Also delete every backup stored under the code (needs signal). Default false. */
  deleteCloudCopy?: boolean;
}

/**
 * Turns cloud backup off: this phone stops uploading but keeps the code, so turning
 * it on again carries on with the same cloud copy. With `deleteCloudCopy`, the
 * server's copies are deleted and the phone forgets the code; if the delete fails (no
 * signal, say), nothing changes and the error says why. Works while backup is off too
 * (deleting the kept code's copy).
 */
export function disableCloudBackup(options: DisableOptions = {}): Promise<CloudResult<void>> {
  return engine.disable(options);
}

export interface BackUpNowOptions {
  /**
   * Upload even if the phone has much less data than the last backup (the parent's
   * "Back up anyway" in the 'paused-shrink' state). Default false.
   */
  force?: boolean;
}

/**
 * Uploads a snapshot right away: also when nothing changed, during a backoff, or while
 * automatic backup waits for the parent (e.g. "Try again" after an error). Resolves
 * once it's done, with the new version or why it failed. 'shrink' (games in the last
 * backup aren't on this phone) and 'other-device' (another phone backed up since this
 * one did) are questions for the parent: ask, then pass `force: true` ("Back up
 * anyway"). That overrides the pause being shown (and any overridden before without an
 * upload); if the other problem turns up instead, it pauses for that one: ask again.
 */
export function backUpNow(options: BackUpNowOptions = {}): Promise<CloudResult<BackupResult>> {
  return engine.backUpNow(options);
}

export interface FetchCloudBackupOptions {
  /** A version from listCloudVersions; the newest when left out. */
  version?: string;
}

/**
 * Downloads and decrypts the backup for a code the parent typed, for a restore
 * preview (`file.players`, `games`, `exportedAt`...). Nothing is imported: to
 * restore, call `importAll(backup.file, 'replace' | 'merge')` from data/transfer.ts,
 * then `enableCloudBackupWithCode(code, { backup })`.
 */
export function fetchCloudBackup(
  code: string,
  options: FetchCloudBackupOptions = {},
): Promise<CloudResult<CloudBackup>> {
  return engine.fetchBackup(code, options);
}

/** Every backup stored under a code, newest first (for "restore an earlier backup"). */
export function listCloudVersions(code: string): Promise<CloudResult<BackupVersion[]>> {
  return engine.listVersions(code);
}

/**
 * This phone's backup code ('7K3M-9QXA-…'), also while backup is off with the code
 * kept (turning backup on reuses it); undefined when the phone has no code.
 */
export function getBackupCode(): Promise<string | undefined> {
  return engine.getCode();
}

/** The status, as a promise (screens use useCloudBackupStatus instead). */
export function getCloudBackupStatus(): Promise<CloudBackupStatus> {
  return engine.getStatus();
}

/** Shortens the scheduler's waits (for e2e tests; see policy.ts for the defaults). */
export function setBackupTimingsForTests(timings: Partial<BackupTimings>): void {
  engine.setTimings(timings);
}

/** For useCloudBackupStatus (useSyncExternalStore). */
export function subscribeToBackupRuntime(listener: () => void): () => void {
  return engine.subscribe(listener);
}

export function getBackupRuntime(): BackupRuntime {
  return engine.getRuntime();
}

/** Resolves once no upload is running or queued (for tests). */
export function whenBackupIdle(): Promise<void> {
  return engine.whenIdle();
}

/** `window.hoopStats.backup`: the same functions, for the console and e2e tests. */
export const cloudBackupConsole = {
  isCloudBackupAvailable,
  enableCloudBackup,
  enableCloudBackupWithCode,
  disableCloudBackup,
  backUpNow,
  fetchCloudBackup,
  listCloudVersions,
  getBackupCode,
  getCloudBackupStatus,
  setBackupTimingsForTests,
};
