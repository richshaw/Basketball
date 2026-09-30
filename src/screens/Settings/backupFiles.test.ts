import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { ExportFileError, parseExportFile, type ExportFile } from '@/data/transfer';
import {
  backupFileName,
  backupFileStatus,
  countGames,
  createBackupFile,
  createSpreadsheetFile,
  describeBackup,
  describePlayer,
  isBackupFileName,
  nothingNewMessage,
  readBackupFile,
  readLastBackupFile,
  rememberBackupFile,
  restoredMessage,
  sampleGamesRemovedNote,
  spreadsheetFileName,
} from './backupFiles';

/** 10:30 in the evening, local time: already the next day in UTC for much of the world. */
const EVENING = new Date(2026, 8, 28, 22, 30);

const demo = (): ExportFile => buildDemoData({ today: '2026-09-28' });

afterEach(() => {
  localStorage.clear();
});

describe('isBackupFileName', () => {
  it("knows this app's backup files, also once renamed as copies", () => {
    expect(isBackupFileName(backupFileName(EVENING))).toBe(true);
    expect(isBackupFileName('hoop-stats-backup-2026-09-28 (1).json')).toBe(true);
    expect(isBackupFileName('Hoop-Stats-Backup-2026-09-28.json')).toBe(true);
    expect(isBackupFileName('hoop-stats-games-2026-09-28.csv')).toBe(false);
    expect(isBackupFileName('notes.json')).toBe(false);
  });
});

describe('file names', () => {
  it('use the local date', () => {
    expect(backupFileName(EVENING)).toBe('hoop-stats-backup-2026-09-28.json');
    expect(spreadsheetFileName(EVENING)).toBe('hoop-stats-games-2026-09-28.csv');
  });
});

describe('createBackupFile', () => {
  it('is a JSON file that restores exactly, named for the day it is saved', async () => {
    const backup = demo();
    const file = createBackupFile(backup, EVENING);

    expect(file.name).toBe('hoop-stats-backup-2026-09-28.json');
    expect(file.type).toBe('application/json');
    // Including its exportedAt: when the data was read, not when the file was saved.
    expect(parseExportFile(await file.text())).toEqual(backup);
  });
});

describe('createSpreadsheetFile', () => {
  it('is a UTF-8 CSV file that keeps its byte order mark', async () => {
    const file = createSpreadsheetFile('\uFEFFDate,Opponent\r\n', EVENING);
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

  const DAMAGED = "This backup is damaged, so it can't be restored.";
  const NOT_A_BACKUP = "This file isn't a Hoop Stats backup.";
  const failureOf = async (file: Blob) =>
    ((await readBackupFile(file).catch((caught: unknown) => caught)) as ExportFileError).message;

  it('calls a backup file that was cut off damaged, whatever it was renamed to', async () => {
    const whole = await createBackupFile(demo(), EVENING).text();
    for (const name of [backupFileName(EVENING), 'backup.json', 'download']) {
      const cut = new File([whole.slice(0, 500)], name, { type: 'application/json' });
      expect(await failureOf(cut)).toBe(DAMAGED);
    }
  });

  it("calls a file with a backup's name that can't be read at all damaged", async () => {
    for (const name of [backupFileName(EVENING), 'hoop-stats-backup-2026-09-28 (1).json']) {
      expect(await failureOf(new File(['\u0000\u0001 garbled'], name))).toBe(DAMAGED);
      expect(await failureOf(new File([''], name))).toBe(DAMAGED);
    }
    // Under any other name, the same bytes are some other file.
    expect(await failureOf(new File(['\u0000\u0001 garbled'], 'notes.json'))).toBe(NOT_A_BACKUP);
    // And a backup's name doesn't make another app's JSON a damaged backup.
    const json = new File(['{"hello":"world"}'], backupFileName(EVENING));
    expect(await failureOf(json)).toBe(NOT_A_BACKUP);
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

  it('says so when the sample games were removed', () => {
    expect(restoredMessage({ games: 6, events: 90, sampleGamesRemoved: 10 }, 6)).toBe(
      'Restored 6 games · 10 sample games removed',
    );
    expect(restoredMessage({ games: 0, events: 0, sampleGamesRemoved: 1 }, 2)).toBe(
      'Nothing new in this backup · 1 sample game removed',
    );
  });

  it('says before the restore which sample games it removes', () => {
    expect(sampleGamesRemovedNote(10)).toBe('The 10 sample games on this phone will be removed.');
    expect(sampleGamesRemovedNote(1)).toBe('The sample game on this phone will be removed.');
    expect(sampleGamesRemovedNote(10, 10)).toBe(
      'The 10 sample games on this phone will be removed.',
    );
    // The backup has the others: they stay.
    expect(sampleGamesRemovedNote(1, 10)).toBe(
      '1 of the 10 sample games on this phone will be removed.',
    );
    expect(sampleGamesRemovedNote(3, 10)).toBe(
      '3 of the 10 sample games on this phone will be removed.',
    );
  });

  it('explains a backup with nothing new, and points to Replace', () => {
    expect(nothingNewMessage(10)).toBe(
      "Nothing new was added: this phone already has all 10 games in this backup (the same, or changed here since). To go back to the backup's versions, use Replace everything on this phone.",
    );
    expect(nothingNewMessage(2)).toMatch(/already has both games in this backup/);
    expect(nothingNewMessage(1)).toMatch(/already has the game in this backup/);
  });
});

describe('the last backup file', () => {
  const saved = { savedAt: EVENING.getTime(), lastChangeAt: EVENING.getTime() - 60_000 };

  it('is remembered on this device', () => {
    expect(readLastBackupFile()).toBeUndefined();
    rememberBackupFile(saved);
    expect(readLastBackupFile()).toEqual(saved);
  });

  it('ignores a damaged value', () => {
    for (const damaged of ['yesterday', '{"savedAt":"soon"}', '12', 'null', '{']) {
      localStorage.setItem('hoop-stats.lastBackupFile', damaged);
      expect(readLastBackupFile()).toBeUndefined();
    }
    localStorage.setItem('hoop-stats.lastBackupFile', `{"savedAt":${saved.savedAt}}`);
    expect(readLastBackupFile()).toEqual({ savedAt: saved.savedAt });
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() => rememberBackupFile(saved)).not.toThrow();
    expect(readLastBackupFile()).toBeUndefined();
  });

  it('is "last saved" only while the data is what that file holds', () => {
    const data = { hasData: true, lastChangeAt: saved.lastChangeAt };
    expect(backupFileStatus(saved, data)).toBe('Last saved: Sep 28, 2026');
    expect(backupFileStatus(saved, { ...data, lastChangeAt: saved.lastChangeAt + 1 })).toBe(
      'Changes since your last backup file on Sep 28, 2026',
    );
    expect(backupFileStatus(undefined, data)).toBe('Not saved on this phone yet');
    expect(backupFileStatus(saved, { ...data, hasData: false })).toBe('Nothing to back up yet');
  });
});
