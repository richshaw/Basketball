/**
 * The cloud backup's state on this phone: one record in the `meta` table, under
 * `BACKUP_STATE_KEY`. No record means cloud backup is off.
 *
 * It is device-local on purpose:
 * - exportAll() never includes it, so the backup code (the secret) is never inside a
 *   backup file or a cloud snapshot;
 * - clearAllData() ("Erase all data") keeps it, so erasing the stats neither turns
 *   backup off nor loses the code. The next check then finds far less data than the
 *   last upload and pauses (the shrink guard), so an erased phone can't silently
 *   replace the good cloud copy;
 * - writing it never bumps `meta.lastChangeAt`: it isn't stats data, and a bump would
 *   make every upload schedule another one.
 *
 * Each write is one transaction. Patches follow the repository's rule: a field that's
 * missing or `undefined` keeps its value, and `null` clears it.
 */
import { db } from '../db';
import { BackupCodeError, normalizeBackupCode } from './code';

export const BACKUP_STATE_KEY = 'cloudBackup';

/**
 * Why automatic backup stopped until the parent does something:
 * - 'shrink': this phone has far less data than the last upload (see isMuchSmaller);
 * - 'code-rejected': the server refused the code's token (401);
 * - 'cloud-deleted': the cloud copy was deleted during an upload (409);
 * - 'too-large': the snapshot is over the server's size limit (413).
 */
export const PAUSE_REASONS = ['shrink', 'code-rejected', 'cloud-deleted', 'too-large'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export interface BackupErrorInfo {
  /** A CloudBackupErrorKind (see errors.ts), stored as text. */
  kind: string;
  /** Written for the parent. */
  message: string;
  /** Epoch ms. */
  at: number;
}

export interface ShrinkInfo {
  /** Games in the last upload. */
  backedUpGames: number;
  /** Games on the phone when the upload was held back. */
  currentGames: number;
  /** `meta.lastChangeAt` at that point, so unchanged data isn't checked again. */
  changeAt?: number;
}

export interface StoredBackupState {
  /** The backup code, formatted ('7K3M-9QXA-…'). The secret: never log or export it. */
  code: string;
  /** When backup was turned on (with this code) on this phone. */
  enabledAt: number;
  /** When the last upload succeeded. */
  lastSuccessAt?: number;
  /** `meta.lastChangeAt` read just before the last successful upload's export. */
  lastUploadedChangeAt?: number;
  /** Games and stats in the last successful upload (or the restored cloud copy). */
  lastUploadedGameCount?: number;
  lastUploadedEventCount?: number;
  /** The server's id for the last upload. */
  lastVersion?: string;
  /** The last failure; cleared by a successful upload. */
  lastError?: BackupErrorInfo;
  /** Failed attempts in a row, for the backoff. */
  failures?: number;
  /** No automatic attempt before this time (epoch ms). */
  nextAttemptAt?: number;
  /** Set while automatic backup waits for the parent. */
  paused?: PauseReason;
  /** Details for `paused: 'shrink'`. */
  shrink?: ShrinkInfo;
}

/** The fields a patch can change; `code` and `enabledAt` identify the backup. */
export type BackupStatePatch = {
  [K in Exclude<keyof StoredBackupState, 'code' | 'enabledAt'>]?: StoredBackupState[K] | null;
};

/** Which backup a write belongs to: a write for a backup that was since turned off is dropped. */
export interface BackupGeneration {
  code: string;
  enabledAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function readErrorInfo(value: unknown): BackupErrorInfo | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, message, at } = value;
  return typeof kind === 'string' && typeof message === 'string' && isTime(at)
    ? { kind, message, at }
    : undefined;
}

function readShrink(value: unknown): ShrinkInfo | undefined {
  if (!isRecord(value)) return undefined;
  const { backedUpGames, currentGames, changeAt } = value;
  if (!isCount(backedUpGames) || !isCount(currentGames)) return undefined;
  return isTime(changeAt)
    ? { backedUpGames, currentGames, changeAt }
    : { backedUpGames, currentGames };
}

function isBackupCode(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return normalizeBackupCode(value) === value;
  } catch (error) {
    if (error instanceof BackupCodeError) return false;
    throw error;
  }
}

/**
 * The stored state, field by field: an optional field that isn't valid is dropped
 * rather than turning backup off, so one bad value can't lose the code. Without a
 * valid code there's no backup to run (nobody could reach it), so that reads as off.
 */
function readState(value: unknown): StoredBackupState | undefined {
  if (!isRecord(value)) return undefined;
  const { code, enabledAt } = value;
  if (!isBackupCode(code) || !isTime(enabledAt)) return undefined;

  const state: StoredBackupState = { code, enabledAt };
  if (isTime(value.lastSuccessAt)) state.lastSuccessAt = value.lastSuccessAt;
  if (isTime(value.lastUploadedChangeAt)) state.lastUploadedChangeAt = value.lastUploadedChangeAt;
  if (isCount(value.lastUploadedGameCount))
    state.lastUploadedGameCount = value.lastUploadedGameCount;
  if (isCount(value.lastUploadedEventCount)) {
    state.lastUploadedEventCount = value.lastUploadedEventCount;
  }
  if (typeof value.lastVersion === 'string') state.lastVersion = value.lastVersion;
  const lastError = readErrorInfo(value.lastError);
  if (lastError) state.lastError = lastError;
  if (isCount(value.failures)) state.failures = value.failures;
  if (isTime(value.nextAttemptAt)) state.nextAttemptAt = value.nextAttemptAt;
  if ((PAUSE_REASONS as readonly unknown[]).includes(value.paused)) {
    state.paused = value.paused as PauseReason;
  }
  const shrink = readShrink(value.shrink);
  if (shrink) state.shrink = shrink;
  return state;
}

/** A copy without `undefined` fields (IndexedDB would store them as keys). */
function compact(state: StoredBackupState): StoredBackupState {
  return Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined),
  ) as unknown as StoredBackupState;
}

async function getState(): Promise<StoredBackupState | undefined> {
  return readState((await db.meta.get(BACKUP_STATE_KEY))?.value);
}

function putState(state: StoredBackupState): Promise<string> {
  return db.meta.put({ key: BACKUP_STATE_KEY, value: compact(state) });
}

function sameGeneration(state: StoredBackupState | undefined, generation: BackupGeneration) {
  return state?.code === generation.code && state.enabledAt === generation.enabledAt;
}

/** The backup's state, or undefined when cloud backup is off. */
export function loadBackupState(): Promise<StoredBackupState | undefined> {
  return getState();
}

/**
 * Turns backup on with `initial` unless it's already on. Resolves to what is stored:
 * `initial`, or the existing state (so two taps on "Turn on" can't make two codes).
 */
export function createBackupState(initial: StoredBackupState): Promise<StoredBackupState> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getState();
    if (existing) return existing;
    const state = compact(initial);
    await putState(state);
    return state;
  });
}

/** Stores `state` in place of whatever was there (e.g. switching to a restored backup's code). */
export function replaceBackupState(state: StoredBackupState): Promise<StoredBackupState> {
  return db.transaction('rw', db.meta, async () => {
    const stored = compact(state);
    await putState(stored);
    return stored;
  });
}

/**
 * Applies `patch` (missing or undefined keeps a field, null clears it) if the stored
 * backup is still `generation`. Resolves to the new state, or undefined if backup was
 * turned off or switched to another code meanwhile (then nothing is written).
 */
export function updateBackupState(
  generation: BackupGeneration,
  patch: BackupStatePatch,
): Promise<StoredBackupState | undefined> {
  return db.transaction('rw', db.meta, async () => {
    const current = await getState();
    if (!current || !sameGeneration(current, generation)) return undefined;
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete next[key];
      else if (value !== undefined) next[key] = value;
    }
    const state = readState(next) ?? current;
    await putState(state);
    return state;
  });
}

/**
 * Turns backup off on this phone (forgets the code). With a generation, only if the
 * stored backup is still that one. Resolves to whether a record was removed.
 */
export function clearBackupState(generation?: BackupGeneration): Promise<boolean> {
  return db.transaction('rw', db.meta, async () => {
    const current = await getState();
    const record = await db.meta.get(BACKUP_STATE_KEY);
    if (!record) return false;
    if (generation && !sameGeneration(current, generation)) return false;
    await db.meta.delete(BACKUP_STATE_KEY);
    return true;
  });
}
