import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { ExportFileError, parseExportFile, type ExportFile } from '@/data/transfer';
import {
  backupFileName,
  countGames,
  createBackupFile,
  createSpreadsheetFile,
  describeBackup,
  describePlayer,
  nothingNewMessage,
  readBackupFile,
  readLastBackupSavedAt,
  rememberBackupSaved,
  restoredMessage,
  spreadsheetFileName,
} from './backupFiles';

/** 10:30 in the evening, local time: already the next day in UTC for much of the world. */
const EVENING = new Date(2026, 8, 28, 22, 30);

const demo = (): ExportFile => buildDemoData({ today: '2026-09-28' });

afterEach(() => {
  localStorage.clear();
});

describe('file names', () => {
  it('use the local date', () => {
    expect(backupFileName(EVENING)).toBe('hoop-stats-backup-2026-09-28.json');
    expect(spreadsheetFileName(EVENING)).toBe('hoop-stats-games-2026-09-28.csv');
  });
});

describe('createBackupFile', () => {
  it('is a JSON file that restores exactly, stamped with when it was saved', async () => {
    const backup = demo();
    const file = createBackupFile(backup, EVENING);

    expect(file.name).toBe('hoop-stats-backup-2026-09-28.json');
    expect(file.type).toBe('application/json');
    const restored = parseExportFile(await file.text());
    expect(restored).toEqual({ ...backup, exportedAt: EVENING.toISOString() });
  });
});

describe('createSpreadsheetFile', () => {
  it('is a UTF-8 CSV file that keeps its byte order mark', async () => {
    const file = createSpreadsheetFile('﻿Date,Opponent\r\n', EVENING);
    expect(file.name).toBe('hoop-stats-games-2026-09-28.csv');
    expect(file.type).toBe('text/csv');
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // Reading it as text (like a spreadsheet app) drops the mark again.
    expect(await file.text()).toBe('Date,Opponent\r\n');
  });
});

describe('readBackupFile', () => {
  it('reads a backup file', async () => {
    const file = createBackupFile(demo(), EVENING);
    const backup = await readBackupFile(file);
    expect(backup.games).toHaveLength(10);
  });

  it("explains a file that isn't a backup", async () => {
    const file = new File(['Date,Opponent\r\n'], 'games.csv', { type: 'text/csv' });
    const error: unknown = await readBackupFile(file).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ExportFileError);
    expect((error as ExportFileError).message).toBe("This file isn't a Hoop Stats backup.");
  });

  it('refuses a huge file without reading it', async () => {
    const huge = new Blob(['x']);
    Object.defineProperty(huge, 'size', { value: 60 * 1024 * 1024 });
    const text = vi.spyOn(huge, 'text');
    await expect(readBackupFile(huge)).rejects.toThrow(
      'This file is too big to be a Hoop Stats backup.',
    );
    expect(text).not.toHaveBeenCalled();
  });

  it("explains a file that can't be read", async () => {
    const broken = new Blob(['{}']);
    vi.spyOn(broken, 'text').mockRejectedValue(new DOMException('Gone', 'NotReadableError'));
    await expect(readBackupFile(broken)).rejects.toThrow(
      "This file couldn't be opened. Try choosing it again.",
    );
  });
});

describe('describing a backup', () => {
  it('gives its date, game count and player', () => {
    const backup = { ...demo(), exportedAt: EVENING.toISOString() };
    expect(describeBackup(backup)).toBe('Backup from Sep 28, 2026 · 10 games · Ava #12');
  });

  it('leaves out a player who was never named, and counts one game', () => {
    const backup = demo();
    const file: ExportFile = {
      ...backup,
      exportedAt: EVENING.toISOString(),
      players: backup.players.map((player) => ({ ...player, name: '' })),
      games: backup.games.slice(0, 1),
      events: [],
    };
    expect(describeBackup(file)).toBe('Backup from Sep 28, 2026 · 1 game');
  });

  it('names a player without a jersey number', () => {
    const [player] = demo().players;
    if (!player) throw new Error('No demo player');
    const { jerseyNumber: _, ...withoutNumber } = player;
    expect(describePlayer({ players: [withoutNumber] })).toBe('Ava');
    expect(describePlayer({ players: [] })).toBeNull();
  });

  it('counts games in words', () => {
    expect(countGames(0)).toBe('No games');
    expect(countGames(1)).toBe('1 game');
    expect(countGames(12)).toBe('12 games');
  });

  it('confirms a restore with what it actually took', () => {
    expect(restoredMessage({ games: 10, events: 250 }, 10)).toBe('Restored 10 games');
    expect(restoredMessage({ games: 1, events: 12 }, 1)).toBe('Restored 1 game');
    expect(restoredMessage({ games: 2, events: 40 }, 10)).toBe(
      'Restored 2 games · 8 already up to date',
    );
    expect(restoredMessage({ games: 1, events: 9 }, 2)).toBe(
      'Restored 1 game · 1 already up to date',
    );
    expect(restoredMessage({ games: 0, events: 0 }, 10)).toBe('Nothing new in this backup');
    expect(restoredMessage({ games: 0, events: 0 }, 0)).toBe('Backup restored');
  });

  it('explains a backup with nothing new, and points to Replace', () => {
    expect(nothingNewMessage(10)).toBe(
      "Nothing new was added: this phone already has all 10 games in this backup (the same, or changed here since). To go back to the backup's versions, use Replace everything on this phone.",
    );
    expect(nothingNewMessage(2)).toMatch(/already has both games in this backup/);
    expect(nothingNewMessage(1)).toMatch(/already has the game in this backup/);
  });
});

describe('last saved', () => {
  it('is remembered on this device', () => {
    expect(readLastBackupSavedAt()).toBeUndefined();
    rememberBackupSaved(EVENING.getTime());
    expect(readLastBackupSavedAt()).toBe(EVENING.getTime());
  });

  it('ignores a damaged value', () => {
    localStorage.setItem('hoop-stats.lastBackupFileSavedAt', 'yesterday');
    expect(readLastBackupSavedAt()).toBeUndefined();
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() => rememberBackupSaved(EVENING.getTime())).not.toThrow();
    expect(readLastBackupSavedAt()).toBeUndefined();
  });
});
