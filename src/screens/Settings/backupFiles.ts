/**
 * Backup and spreadsheet files: their names and contents, reading a backup the parent
 * picked, describing it before a restore, and remembering when one was last saved.
 */
import { primaryPlayer } from '@/data/repo';
import {
  ExportFileError,
  parseExportFile,
  type ExportFile,
  type ImportSummary,
} from '@/data/transfer';
import { formatPlayerName, todayLocalISO } from '@/lib/format';

/** e.g. 'hoop-stats-backup-2026-09-28.json' (the local date). */
export function backupFileName(now: Date): string {
  return `hoop-stats-backup-${todayLocalISO(now)}.json`;
}

/** e.g. 'hoop-stats-games-2026-09-28.csv' (the local date). */
export function spreadsheetFileName(now: Date): string {
  return `hoop-stats-games-${todayLocalISO(now)}.csv`;
}

/**
 * The backup as a readable JSON file, named for the day it's saved. It keeps its own
 * `exportedAt` (when the data was read), which says what it holds.
 */
export function createBackupFile(backup: ExportFile, now: Date): File {
  return new File([JSON.stringify(backup, null, 2)], backupFileName(now), {
    type: 'application/json',
  });
}

export function createSpreadsheetFile(csv: string, now: Date): File {
  return new File([csv], spreadsheetFileName(now), { type: 'text/csv' });
}

/** Far bigger than any real backup (a season is well under 1 MB): don't even read it. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/**
 * Named like a backup file this app saves (see backupFileName), also once the Files app
 * or a download has added to the name ('hoop-stats-backup-2026-09-28 (1).json').
 */
export function isBackupFileName(name: string): boolean {
  return /^hoop-stats-backup/i.test(name.trim());
}

/**
 * Reads and checks a file the parent picked. Rejects with an ExportFileError whose
 * message is written for the parent. A file named like our backups that can't be read
 * at all (cut off, say) is a damaged backup, not some other file.
 */
export async function readBackupFile(file: Blob): Promise<ExportFile> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new ExportFileError('This file is too big to be a Hoop Stats backup.', [
      `size: ${file.size} bytes`,
    ]);
  }
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    throw new ExportFileError("This file couldn't be opened. Try choosing it again.", [
      String(error),
    ]);
  }
  return parseExportFile(text, { ours: file instanceof File && isBackupFileName(file.name) });
}

/** '10 games', '1 game' or 'No games'. */
export function countGames(count: number): string {
  if (count === 0) return 'No games';
  return count === 1 ? '1 game' : `${count} games`;
}

/** 'Sep 28, 2026' in local time. */
export function formatDayWithYear(time: number | Date): string {
  return new Date(time).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** 'Ava #12', 'Ava', or null when the player was never named. */
export function describePlayer(file: Pick<ExportFile, 'players'>): string | null {
  const player = primaryPlayer(file.players);
  if (!player?.name.trim()) return null;
  const name = formatPlayerName(player);
  return player.jerseyNumber ? `${name} #${player.jerseyNumber}` : name;
}

/** What a backup holds: ['Backup from Sep 28, 2026', '10 games', 'Ava #12']. */
export function backupSummary(file: ExportFile): string[] {
  const parts = [
    `Backup from ${formatDayWithYear(Date.parse(file.exportedAt))}`,
    countGames(file.games.length),
  ];
  const player = describePlayer(file);
  if (player) parts.push(player);
  return parts;
}

/** What a backup holds, e.g. 'Backup from Sep 28, 2026 · 10 games · Ava #12'. */
export function describeBackup(file: ExportFile): string {
  return backupSummary(file).join(' · ');
}

/**
 * What the toast says after a restore, from what importAll actually took (not what
 * the file holds): 'Restored 10 games', 'Restored 2 games · 8 already up to date' (the
 * phone had those, the same or newer), or 'Backup restored' for a backup with no games.
 */
export function restoredMessage(taken: ImportSummary, backupGameCount: number): string {
  if (backupGameCount === 0) return 'Backup restored';
  if (taken.games === 0) return 'Nothing new in this backup';
  const restored = `Restored ${countGames(taken.games)}`;
  const upToDate = backupGameCount - taken.games;
  return upToDate > 0 ? `${restored} · ${upToDate} already up to date` : restored;
}

/**
 * Why adding a backup took nothing (this phone already has every game in it), and the
 * way to get the backup's versions back anyway.
 */
export function nothingNewMessage(backupGameCount: number): string {
  let games = `all ${backupGameCount} games`;
  if (backupGameCount === 1) games = 'the game';
  else if (backupGameCount === 2) games = 'both games';
  return `Nothing new was added: this phone already has ${games} in this backup (the same, or changed here since). To go back to the backup's versions, use Replace everything on this phone.`;
}

// The last backup file saved on this phone. A per-device reminder, so it lives in
// localStorage (not in the backup); it may be missing, e.g. in a private window.
const LAST_BACKUP_KEY = 'hoop-stats.lastBackupFile';

export interface LastBackupFile {
  /** When it was saved (epoch ms). */
  savedAt: number;
  /** The data's `lastChangeAt` when it was read: tells whether anything changed since. */
  lastChangeAt?: number;
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** The last backup file saved on this device, if known. */
export function readLastBackupFile(): LastBackupFile | undefined {
  try {
    const stored = localStorage.getItem(LAST_BACKUP_KEY);
    const value: unknown = stored === null ? null : JSON.parse(stored);
    if (typeof value !== 'object' || value === null) return undefined;
    const { savedAt, lastChangeAt } = value as Record<string, unknown>;
    if (!isTime(savedAt)) return undefined;
    return isTime(lastChangeAt) ? { savedAt, lastChangeAt } : { savedAt };
  } catch {
    return undefined;
  }
}

export function rememberBackupFile(file: LastBackupFile): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify(file));
  } catch {
    // Storage full or blocked: it's only a reminder.
  }
}

/**
 * The "Save a backup file" row's subtitle. "Last saved" only while the data is still
 * what that file holds: after any change (a new game, a restore, erasing everything)
 * it says there are changes since, so it never vouches for data no file has.
 */
export function backupFileStatus(
  lastSaved: LastBackupFile | undefined,
  data: { hasData: boolean; lastChangeAt: number | undefined },
): string {
  if (!data.hasData) return 'Nothing to back up yet';
  if (!lastSaved) return 'Not saved on this phone yet';
  const day = formatDayWithYear(lastSaved.savedAt);
  return lastSaved.lastChangeAt === data.lastChangeAt
    ? `Last saved: ${day}`
    : `Changes since your last backup file on ${day}`;
}
