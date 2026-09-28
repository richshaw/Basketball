/**
 * Backup and spreadsheet files: their names and contents, reading a backup the parent
 * picked, describing it before a restore, and remembering when one was last saved.
 */
import { primaryPlayer } from '@/data/repo';
import { ExportFileError, parseExportFile, type ExportFile } from '@/data/transfer';
import { formatPlayerName, todayLocalISO } from '@/lib/format';

/** e.g. 'hoop-stats-backup-2026-09-28.json' (the local date). */
export function backupFileName(now: Date): string {
  return `hoop-stats-backup-${todayLocalISO(now)}.json`;
}

/** e.g. 'hoop-stats-games-2026-09-28.csv' (the local date). */
export function spreadsheetFileName(now: Date): string {
  return `hoop-stats-games-${todayLocalISO(now)}.csv`;
}

/** The backup as a readable JSON file, stamped with the time it's saved. */
export function createBackupFile(backup: ExportFile, now: Date): File {
  const contents: ExportFile = { ...backup, exportedAt: now.toISOString() };
  return new File([JSON.stringify(contents, null, 2)], backupFileName(now), {
    type: 'application/json',
  });
}

export function createSpreadsheetFile(csv: string, now: Date): File {
  return new File([csv], spreadsheetFileName(now), { type: 'text/csv' });
}

/** Far bigger than any real backup (a season is well under 1 MB): don't even read it. */
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/**
 * Reads and checks a file the parent picked. Rejects with an ExportFileError whose
 * message is written for the parent.
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
  return parseExportFile(text);
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

/** What the toast says after a restore: 'Restored 10 games'. */
export function restoredMessage(gameCount: number): string {
  return gameCount === 0 ? 'Backup restored' : `Restored ${countGames(gameCount)}`;
}

// When this phone last saved a backup file. A per-device reminder, so it lives in
// localStorage (not in the backup); it may be missing, e.g. in a private window.
const LAST_BACKUP_KEY = 'hoop-stats.lastBackupFileSavedAt';

/** Epoch ms of the last backup file saved on this device, if known. */
export function readLastBackupSavedAt(): number | undefined {
  try {
    const stored = localStorage.getItem(LAST_BACKUP_KEY);
    const time = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(time) && time > 0 ? time : undefined;
  } catch {
    return undefined;
  }
}

export function rememberBackupSaved(time: number): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(time));
  } catch {
    // Storage full or blocked: it's only a reminder.
  }
}
