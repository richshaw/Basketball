/**
 * The cloud backup's state on this phone: one record in the `meta` table, under
 * `BACKUP_STATE_KEY`. No record means this phone has no backup code; a record with
 * `disabledAt` means backup is off but the code is kept, so turning it back on reuses
 * it (and its account on the server) instead of making a new one.
 *
 * It is device-local on purpose:
 * - exportAll() never includes it, so the backup code (the secret) is never inside a
 *   backup file or a cloud snapshot;
 * - clearAllData() ("Erase all data") keeps it, so erasing the stats neither turns
 *   backup off nor loses the code. The next check then finds the backed-up games gone
 *   and pauses (the shrink guard), so an erased phone can't silently replace the good
 *   cloud copy;
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
 * - 'shrink': the phone no longer has games the backup has (see shrinkCheck);
 * - 'other-device': another phone uploaded under this code since this one did;
 * - 'code-rejected': the server refused the code's token (401);
 * - 'cloud-deleted': the cloud copy was deleted (409 on an upload, or 401 once this
 *   phone had backed up);
 * - 'too-large': the snapshot is over the server's size limit (413).
 */
export const PAUSE_REASONS = [
  'shrink',
  'other-device',
  'code-rejected',
  'cloud-deleted',
  'too-large',
] as const;
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
  /** Real (not sample) games in the backup. */
  backedUpGames: number;
  /** How many of them the phone no longer has. */
  missingGames: number;
  /** `meta.lastChangeAt` when checked, so unchanged data isn't checked again. */
  changeAt?: number;
}

export interface OtherDeviceInfo {
  /** The newest version on the server, uploaded by another phone. */
  version: string;
  /** When it was uploaded (epoch ms, server clock). */
  createdAt?: number;
}

export interface StoredBackupState {
  /** The backup code, formatted ('7K3M-9QXA-…'). The secret: never log or export it. */
  code: string;
  /** When backup was (last) turned on with this code on this phone. */
  enabledAt: number;
  /** Set while backup is off; the code is kept for when it's turned back on. */
  disabledAt?: number;
  /** When the last upload succeeded. */
  lastSuccessAt?: number;
  /** `meta.lastChangeAt` read just before the last successful upload's export. */
  lastUploadedChangeAt?: number;
  /**
   * Ids of the real (not sample) games in the last successful upload, or in the backup
   * restored from: the shrink guard's baseline.
   */
  backedUpGameIds?: string[];
  /** Stats of those games in it. */
  backedUpEventCount?: number;
  /** The server's id for the last version this phone uploaded (or restored from). */
  lastVersion?: string;
  /**
   * Size of an upload whose answer never came (lost connection, app suspended). If the
   * server's newest version has exactly this size, it's ours, not another phone's.
   */
  pendingUploadSize?: number;
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
  /** Details for `paused: 'other-device'`. */
  otherDevice?: OtherDeviceInfo;
}

/** The fields a patch can change; `code`, `enabledAt` and `disabledAt` identify the backup. */
export type BackupStatePatch = {
  [K in Exclude<keyof StoredBackupState, 'code' | 'enabledAt' | 'disabledAt'>]?:
    StoredBackupState[K] | null;
};

/** Which backup a write belongs to: a write for a backup that was since turned off is dropped. */
export interface BackupGeneration {
  code: string;
  enabledAt: number;
}

/** Fields that only mean something while backup is on (cleared when it's turned off or on). */
const TRANSIENT_FIELDS = [
  'lastError',
  'failures',
  'nextAttemptAt',
  'paused',
  'shrink',
  'otherDevice',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
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

function readErrorInfo(value: unknown): BackupErrorInfo | undefined {
  if (!isRecord(value)) return undefined;
  const { kind, message, at } = value;
  return typeof kind === 'string' && typeof message === 'string' && isTime(at)
    ? { kind, message, at }
    : undefined;
}

function readShrink(value: unknown): ShrinkInfo | undefined {
  if (!isRecord(value)) return undefined;
  const { backedUpGames, missingGames, changeAt } = value;
  if (!isCount(backedUpGames) || !isCount(missingGames)) return undefined;
  return isTime(changeAt)
    ? { backedUpGames, missingGames, changeAt }
    : { backedUpGames, missingGames };
}

function readOtherDevice(value: unknown): OtherDeviceInfo | undefined {
  if (!isRecord(value) || typeof value.version !== 'string') return undefined;
  return isTime(value.createdAt)
    ? { version: value.version, createdAt: value.createdAt }
    : { version: value.version };
}

function readGameIds(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((id) => typeof id === 'string') ? value : undefined;
}

/**
 * The stored state, field by field: an optional field that isn't valid is dropped
 * rather than losing the backup, so one bad value can't lose the code. Without a
 * valid code there's no backup to run (nobody could reach it), so that reads as none.
 */
function readState(value: unknown): StoredBackupState | undefined {
  if (!isRecord(value)) return undefined;
  const { code, enabledAt } = value;
  if (!isBackupCode(code) || !isTime(enabledAt)) return undefined;

  const state: StoredBackupState = { code, enabledAt };
  if (isTime(value.disabledAt)) state.disabledAt = value.disabledAt;
  if (isTime(value.lastSuccessAt)) state.lastSuccessAt = value.lastSuccessAt;
  if (isTime(value.lastUploadedChangeAt)) state.lastUploadedChangeAt = value.lastUploadedChangeAt;
  const gameIds = readGameIds(value.backedUpGameIds);
  if (gameIds) state.backedUpGameIds = gameIds;
  if (isCount(value.backedUpEventCount)) state.backedUpEventCount = value.backedUpEventCount;
  if (typeof value.lastVersion === 'string') state.lastVersion = value.lastVersion;
  if (isCount(value.pendingUploadSize)) state.pendingUploadSize = value.pendingUploadSize;
  const lastError = readErrorInfo(value.lastError);
  if (lastError) state.lastError = lastError;
  if (isCount(value.failures)) state.failures = value.failures;
  if (isTime(value.nextAttemptAt)) state.nextAttemptAt = value.nextAttemptAt;
  if ((PAUSE_REASONS as readonly unknown[]).includes(value.paused)) {
    state.paused = value.paused as PauseReason;
  }
  const shrink = readShrink(value.shrink);
  if (shrink) state.shrink = shrink;
  const otherDevice = readOtherDevice(value.otherDevice);
  if (otherDevice) state.otherDevice = otherDevice;
  return state;
}

/** A copy without `undefined` fields (IndexedDB would store them as keys). */
function compact(state: StoredBackupState): StoredBackupState {
  return Object.fromEntries(
    Object.entries(state).filter(([, value]) => value !== undefined),
  ) as unknown as StoredBackupState;
}

function withoutTransient(state: StoredBackupState): StoredBackupState {
  const next: Record<string, unknown> = { ...state };
  for (const field of TRANSIENT_FIELDS) delete next[field];
  return next as unknown as StoredBackupState;
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

/** Whether cloud backup is on (a code, not turned off). */
export function isBackupOn(state: StoredBackupState | undefined): state is StoredBackupState {
  return state !== undefined && state.disabledAt === undefined;
}

/** The stored state (on, or off with its code kept), or undefined when there's no code. */
export function loadBackupState(): Promise<StoredBackupState | undefined> {
  return getState();
}

/**
 * Turns backup on and resolves to what's stored: the state as it is if backup is on
 * already (so two taps on "Turn on" can't make two codes), the kept code if it was
 * turned off, or else a new state with `newCode`.
 */
export function turnOnBackupState(newCode: string, now: number): Promise<StoredBackupState> {
  return db.transaction('rw', db.meta, async () => {
    const existing = await getState();
    if (isBackupOn(existing)) return existing;
    const state = compact(
      existing
        ? { ...withoutTransient(existing), enabledAt: now, disabledAt: undefined }
        : { code: newCode, enabledAt: now },
    );
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
 * Applies `patch` (missing or undefined keeps a field, null clears it) if backup is
 * still on as `generation`. Resolves to the new state, or undefined if backup was
 * turned off, turned on again or switched to another code meanwhile (then nothing is
 * written).
 */
export function updateBackupState(
  generation: BackupGeneration,
  patch: BackupStatePatch,
): Promise<StoredBackupState | undefined> {
  return db.transaction('rw', db.meta, async () => {
    const current = await getState();
    if (!isBackupOn(current) || !sameGeneration(current, generation)) return undefined;
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
 * Turns backup off but keeps the code (and what it knows about the backup), if backup
 * is still on as `generation`. Resolves to whether it did.
 */
export function turnOffBackupState(generation: BackupGeneration, now: number): Promise<boolean> {
  return db.transaction('rw', db.meta, async () => {
    const current = await getState();
    if (!isBackupOn(current) || !sameGeneration(current, generation)) return false;
    await putState({ ...withoutTransient(current), disabledAt: now });
    return true;
  });
}

/**
 * Forgets the code (after its cloud copy was deleted). With a generation, only if the
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
