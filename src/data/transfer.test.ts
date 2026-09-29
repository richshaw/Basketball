import { describe, expect, it, vi } from 'vitest';
import { db, META_KEYS } from './db';
import { buildDemoData } from './demo';
import {
  createGame,
  deleteGame,
  deleteStat,
  endGame,
  getGame,
  getGameEvents,
  getLastChangeAt,
  getPlayer,
  getSettings,
  listGames,
  recordStat,
  savePlayer,
  setCurrentPeriod,
  setStatLocation,
  undoLastStat,
  updateGame,
  updateSettings,
} from './repo';
import {
  clearAllData,
  exportAll,
  ExportFileError,
  importAll,
  parseExportFile,
  type ExportFile,
} from './transfer';
import type { Game, Player, StatEvent } from './types';

/** Some data made the way the app makes it. */
async function seedWithRepo() {
  await savePlayer({ name: 'Ava', jerseyNumber: '12' });
  const overtime = await createGame({
    opponent: 'Lincoln',
    date: '2026-09-20',
    season: 'Fall 2026',
    homeAway: 'home',
    periodFormat: 'quarters',
  });
  await recordStat(overtime.id, 'fg2_made', { x: 2.5, y: 3.1 });
  await recordStat(overtime.id, 'fg3_miss', { x: -21.3, y: -1.2 });
  await recordStat(overtime.id, 'ft_made');
  await setCurrentPeriod(overtime.id, 5);
  await recordStat(overtime.id, 'charge');
  await endGame(overtime.id, { teamScore: 51, opponentScore: 48 });
  await updateGame(overtime.id, { notes: 'Won in OT!\nGreat defense.' });
  const live = await createGame({
    opponent: 'Roosevelt',
    date: '2026-09-27',
    periodFormat: 'halves',
  });
  await recordStat(live.id, 'dreb');
  await updateSettings({ shotChart: false });
  return { overtime, live };
}

function withoutExportedAt({ exportedAt: _, ...rest }: ExportFile) {
  return rest;
}

/** A JSON round trip, like saving the backup to a file and reading it back. */
function viaJson(file: ExportFile): unknown {
  return JSON.parse(JSON.stringify(file)) as unknown;
}

const player: Player = { id: 'p1', name: 'Ava', createdAt: 1000, updatedAt: 1000 };

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerId: 'p1',
    opponent: 'Lincoln',
    date: '2026-09-20',
    periodFormat: 'quarters',
    currentPeriod: 4,
    status: 'final',
    createdAt: 2000,
    updatedAt: 3000,
    ...overrides,
  };
}

function event(overrides: Partial<StatEvent> = {}): StatEvent {
  return { id: 'e1', gameId: 'g1', type: 'ast', period: 1, createdAt: 2500, ...overrides };
}

function file(overrides: Partial<ExportFile> = {}): ExportFile {
  return {
    app: 'hoop-stats',
    schemaVersion: 1,
    exportedAt: '2026-09-28T12:00:00.000Z',
    players: [player],
    games: [game()],
    events: [event()],
    ...overrides,
  };
}

describe('exportAll', () => {
  it('exports an empty device', async () => {
    const exported = await exportAll();
    expect(exported).toEqual({
      app: 'hoop-stats',
      schemaVersion: 1,
      exportedAt: expect.any(String) as string,
      players: [],
      games: [],
      events: [],
      settings: { shotChart: true, defaultPeriodFormat: 'quarters' },
    });
    expect(new Date(exported.exportedAt).toISOString()).toBe(exported.exportedAt);
  });

  it('exports everything, games oldest first and events in order', async () => {
    const { overtime, live } = await seedWithRepo();
    const exported = await exportAll();
    expect(exported.players).toEqual([await getPlayer()]);
    expect(exported.games.map((g) => g.id)).toEqual([overtime.id, live.id]);
    expect(exported.events.filter((e) => e.gameId === overtime.id)).toEqual(
      await getGameEvents(overtime.id),
    );
    expect(exported.events).toHaveLength(5);
    expect(exported.settings).toEqual(await getSettings());
  });
});

describe('round trip', () => {
  it('restores exactly what was exported, through JSON', async () => {
    await seedWithRepo();
    const before = await exportAll();

    await clearAllData();
    expect((await exportAll()).games).toEqual([]);

    await importAll(parseExportFile(viaJson(before)), 'replace');
    const after = await exportAll();
    expect(withoutExportedAt(after)).toEqual(withoutExportedAt(before));
    // And again, from the JSON text itself.
    await importAll(parseExportFile(JSON.stringify(after)), 'replace');
    expect(withoutExportedAt(await exportAll())).toEqual(withoutExportedAt(before));
  });

  it('restores the demo data exactly', async () => {
    const demo = buildDemoData({ today: '2026-09-28', liveGame: true });
    await importAll(parseExportFile(viaJson(demo)), 'replace');
    expect(withoutExportedAt(await exportAll())).toEqual(withoutExportedAt(demo));
  });

  it('keeps using restored games normally', async () => {
    const { live } = await seedWithRepo();
    const backup = viaJson(await exportAll());
    await clearAllData();
    await importAll(parseExportFile(backup), 'replace');

    const tap = await recordStat(live.id, 'ast');
    expect(tap.createdAt).toBeGreaterThan(
      Math.max(...(await getGameEvents(live.id)).slice(0, -1).map((e) => e.createdAt)),
    );
    expect(await getSettings()).toMatchObject({ shotChart: false, lastSeason: 'Fall 2026' });
  });
});

describe('importAll replace', () => {
  it("replaces everything on the device with the file's data", async () => {
    await seedWithRepo();
    const summary = await importAll(file(), 'replace');
    expect(summary).toEqual({ games: 1, events: 1 });
    expect(await listGames()).toEqual([game()]);
    expect(await getPlayer()).toEqual(player);
    expect(await getGameEvents('g1')).toEqual([event()]);
    // The file has no settings, so the device keeps its own.
    expect((await getSettings()).shotChart).toBe(false);
  });

  it('restores settings from the file', async () => {
    await importAll(
      file({ settings: { shotChart: false, defaultPeriodFormat: 'halves', lastSeason: 'JV' } }),
      'replace',
    );
    expect(await getSettings()).toEqual({
      shotChart: false,
      defaultPeriodFormat: 'halves',
      lastSeason: 'JV',
    });
  });

  it('bumps lastChangeAt', async () => {
    await importAll(file(), 'replace');
    expect(await getLastChangeAt()).toEqual(expect.any(Number));
  });
});

describe('importAll merge', () => {
  it("adds the file's games and keeps the device's", async () => {
    await importAll(file(), 'replace');
    const summary = await importAll(
      file({
        games: [game({ id: 'g2', opponent: 'Roosevelt', date: '2026-09-27' })],
        events: [event({ id: 'e2', gameId: 'g2', type: 'stl' })],
      }),
      'merge',
    );
    expect(summary).toEqual({ games: 1, events: 1 });
    expect((await listGames()).map((g) => g.id)).toEqual(['g2', 'g1']);
    expect(await getGameEvents('g1')).toEqual([event()]);
    expect(await getGameEvents('g2')).toEqual([event({ id: 'e2', gameId: 'g2', type: 'stl' })]);
  });

  it('keeps whichever copy of a game was updated most recently, with its events', async () => {
    const localG2Event = event({ id: 'local-g2', gameId: 'g2', type: 'blk' });
    await importAll(
      file({
        games: [game(), game({ id: 'g2', opponent: 'Local newer', updatedAt: 9000 })],
        events: [event(), localG2Event],
      }),
      'replace',
    );
    const summary = await importAll(
      file({
        games: [
          game({ opponent: 'File newer', updatedAt: 5000, teamScore: 50, opponentScore: 40 }),
          game({ id: 'g2', opponent: 'File older', updatedAt: 4000 }),
        ],
        events: [event({ id: 'file-g2', gameId: 'g2', type: 'tov' })],
      }),
      'merge',
    );
    expect(summary).toEqual({ games: 1, events: 0 });
    // The file's newer g1 has no stats, so it replaces g1's stats with none.
    expect(await getGame('g1')).toMatchObject({ opponent: 'File newer', teamScore: 50 });
    expect(await getGameEvents('g1')).toEqual([]);
    // The device's newer g2 keeps its own stats and gets none of the file's.
    expect(await getGame('g2')).toMatchObject({ opponent: 'Local newer' });
    expect(await getGameEvents('g2')).toEqual([localG2Event]);
  });

  it('skips an older copy of a game with its events, so undone stats stay undone', async () => {
    const tracked = await createGame({
      opponent: 'Lincoln',
      date: '2026-09-20',
      periodFormat: 'quarters',
    });
    const made = await recordStat(tracked.id, 'fg2_made');
    await recordStat(tracked.id, 'fg3_made'); // A mis-tap...
    const backup = await exportAll();
    await undoLastStat(tracked.id); // ...undone after the backup was made.
    const lastChange = await getLastChangeAt();

    expect(await importAll(backup, 'merge')).toEqual({ games: 0, events: 0 });
    expect(await getGameEvents(tracked.id)).toEqual([made]);
    expect(await getLastChangeAt()).toBe(lastChange);
  });

  it('takes a newer copy of a game whole, with stats deleted and moved there', async () => {
    const tracked = await createGame({
      opponent: 'Lincoln',
      date: '2026-09-20',
      periodFormat: 'quarters',
    });
    const shot = await recordStat(tracked.id, 'fg2_made', { x: 2, y: 3 });
    const mistake = await recordStat(tracked.id, 'fg3_made');
    const older = await exportAll();
    await setStatLocation(shot.id, { x: -4, y: 10 });
    await deleteStat(mistake.id);
    const assist = await recordStat(tracked.id, 'ast');
    const newer = await exportAll();

    // The phone goes back to the older backup, then the newer one is merged in.
    await importAll(older, 'replace');
    expect(await importAll(newer, 'merge')).toEqual({ games: 1, events: 2 });
    expect(await getGameEvents(tracked.id)).toEqual([
      { ...shot, location: { x: -4, y: 10 } },
      assist,
    ]);
    expect(withoutExportedAt(await exportAll())).toEqual(withoutExportedAt(newer));
  });

  it("keeps the device's copy of a game updated at the same moment", async () => {
    await importAll(file(), 'replace');
    const summary = await importAll(
      file({
        games: [game({ opponent: 'Same age' })],
        events: [event({ id: 'e2', type: 'blk' })],
      }),
      'merge',
    );
    expect(summary).toEqual({ games: 0, events: 0 });
    expect(await getGame('g1')).toEqual(game());
    expect(await getGameEvents('g1')).toEqual([event()]);
  });

  it('brings back a game that was deleted on the device', async () => {
    await importAll(file(), 'replace');
    const backup = await exportAll();
    await deleteGame('g1');
    expect(await importAll(backup, 'merge')).toEqual({ games: 1, events: 1 });
    expect(await getGame('g1')).toEqual(game());
    expect(await getGameEvents('g1')).toEqual([event()]);
  });

  it("keeps one player when the file's player has a different id", async () => {
    // A new phone: a game was tracked before the old backup was merged in.
    const local = await createGame({
      opponent: 'Today',
      date: '2026-09-28',
      periodFormat: 'quarters',
    });
    const localPlayer = await getPlayer();
    await importAll(file({ players: [{ ...player, updatedAt: 1 }] }), 'merge');

    expect(await db.players.count()).toBe(1);
    const merged = await getPlayer();
    // The new phone's player was never named, so the backup's name is kept.
    expect(merged).toMatchObject({ id: localPlayer?.id, name: 'Ava', createdAt: 1000 });
    expect((await listGames()).map((g) => [g.id, g.playerId])).toEqual([
      [local.id, localPlayer?.id],
      ['g1', localPlayer?.id],
    ]);
  });

  it("takes the player's details from whichever was saved most recently", async () => {
    await importAll(
      file({ players: [{ ...player, jerseyNumber: '12', updatedAt: 1000 }] }),
      'replace',
    );
    await importAll(
      file({ players: [{ ...player, name: 'Ava Smith', updatedAt: 2000 }], games: [], events: [] }),
      'merge',
    );
    expect(await getPlayer()).toEqual({ ...player, name: 'Ava Smith', updatedAt: 2000 });

    await importAll(
      file({ players: [{ ...player, name: 'Old name', updatedAt: 1500 }], games: [], events: [] }),
      'merge',
    );
    expect((await getPlayer())?.name).toBe('Ava Smith');
  });

  it("keeps the device's settings, or fills them in if there are none", async () => {
    const fileSettings = {
      shotChart: false,
      defaultPeriodFormat: 'halves',
      lastSeason: 'JV',
    } as const;
    await importAll(file({ settings: fileSettings }), 'merge');
    expect(await getSettings()).toEqual(fileSettings);

    await updateSettings({ shotChart: true });
    await importAll(
      file({ settings: { shotChart: false, defaultPeriodFormat: 'quarters' } }),
      'merge',
    );
    expect(await getSettings()).toEqual({ ...fileSettings, shotChart: true });
  });
});

describe('importAll safety', () => {
  it('changes nothing if the import fails partway through', async () => {
    await seedWithRepo();
    const before = await exportAll();
    const lastChange = await getLastChangeAt();

    // Each mode fails on its last write, after clearing or replacing other data.
    const diskFull = new Error('Disk full');
    const bulkAdd = vi.spyOn(db.events, 'bulkAdd').mockRejectedValue(diskFull);
    const bulkPut = vi.spyOn(db.events, 'bulkPut').mockRejectedValue(diskFull);
    await expect(importAll(file(), 'replace')).rejects.toThrow('Disk full');
    await expect(
      importAll(
        file({ games: [game({ id: 'new' })], events: [event({ gameId: 'new' })] }),
        'merge',
      ),
    ).rejects.toThrow('Disk full');
    expect(bulkAdd).toHaveBeenCalledOnce();
    expect(bulkPut).toHaveBeenCalledOnce();

    bulkAdd.mockRestore();
    bulkPut.mockRestore();
    expect(withoutExportedAt(await exportAll())).toEqual(withoutExportedAt(before));
    expect(await getLastChangeAt()).toBe(lastChange);
  });

  it('validates the file again, even when it is typed as an ExportFile', async () => {
    await seedWithRepo();
    const before = await exportAll();
    const bad = file({ games: [game({ date: 'someday' })] });
    await expect(importAll(bad, 'replace')).rejects.toThrow(ExportFileError);
    await expect(importAll(file(), 'overwrite' as 'merge')).rejects.toThrow(TypeError);
    expect(withoutExportedAt(await exportAll())).toEqual(withoutExportedAt(before));
  });
});

describe('imports and lastChangeAt', () => {
  it('moves only when an import changes something', async () => {
    await seedWithRepo();
    const backup = await exportAll();
    const start = await getLastChangeAt();

    // Merging or restoring exactly what the device holds changes nothing.
    expect(await importAll(backup, 'merge')).toEqual({ games: 0, events: 0 });
    expect(await importAll(backup, 'replace')).toEqual({ games: 2, events: 5 });
    await importAll(parseExportFile(viaJson(backup)), 'replace');
    expect(await getLastChangeAt()).toBe(start);

    // Bringing in a game does.
    const ava = await getPlayer();
    await importAll(
      file({
        players: backup.players,
        games: [game({ id: 'new', playerId: ava?.id ?? '' })],
        events: [event({ gameId: 'new' })],
      }),
      'merge',
    );
    expect(await getLastChangeAt()).toBeGreaterThan(start ?? 0);
  });

  it('does not move when clearing a device that is already empty', async () => {
    await clearAllData();
    expect(await getLastChangeAt()).toBeUndefined();
    await db.meta.put({ key: 'backup', value: { enabled: true } });
    await clearAllData();
    expect(await getLastChangeAt()).toBeUndefined();
  });
});

describe('parseExportFile', () => {
  function rejection(input: unknown, options?: { ours?: boolean }): ExportFileError {
    try {
      parseExportFile(input, options);
    } catch (error) {
      if (error instanceof ExportFileError) return error;
      throw error;
    }
    throw new Error('Expected parseExportFile to throw');
  }

  const NOT_A_BACKUP = "This file isn't a Hoop Stats backup.";
  const DAMAGED = "This backup is damaged, so it can't be restored.";

  it('accepts a valid file, as an object or as JSON text', () => {
    expect(parseExportFile(file())).toEqual(file());
    expect(parseExportFile(JSON.stringify(file()))).toEqual(file());
  });

  it('drops fields it does not know', () => {
    const parsed = parseExportFile({
      ...file(),
      extra: true,
      games: [{ ...game(), secret: 'x' }],
    });
    expect(parsed).toEqual(file());
  });

  it.each([
    ['text that is not JSON', 'hello'],
    ['null', null],
    ['a number', 42],
    ['an array', [file()]],
    ['an empty object', {}],
    ["another app's file", { ...file(), app: 'hoop-stats-pro' }],
    ['a file with no app', { schemaVersion: 1, players: [], games: [], events: [] }],
  ])('rejects %s as not a backup', (_, input) => {
    const error = rejection(input);
    expect(error.message).toBe(NOT_A_BACKUP);
    expect(error.name).toBe('ExportFileError');
  });

  it('calls a backup that was cut off damaged, not some other file', () => {
    const text = JSON.stringify(file({ games: [game()], events: [event()] }), null, 2);
    for (const cut of [text.slice(0, 500), text.slice(0, 30), text.slice(0, -1)]) {
      expect(rejection(cut).message).toBe(DAMAGED);
    }
    // Written without spaces, or read with a byte order mark in front.
    expect(rejection(JSON.stringify(file()).slice(0, 100)).message).toBe(DAMAGED);
    expect(rejection(`\uFEFF${text.slice(0, 100)}`).message).toBe(DAMAGED);
    // Only that start counts: other text that isn't JSON is some other file.
    expect(rejection('{"application": "hoop-stats"').message).toBe(NOT_A_BACKUP);
  });

  it('calls text it cannot read damaged when it is known to be a backup', () => {
    expect(rejection('hello', { ours: true }).message).toBe(DAMAGED);
    expect(rejection('', { ours: true }).message).toBe(DAMAGED);
    // It still has to be a backup once it's read.
    expect(rejection('{"hello":"world"}', { ours: true }).message).toBe(NOT_A_BACKUP);
  });

  it('asks to update the app for a file from a newer version, whatever it holds', () => {
    const UPDATE =
      'This backup is from a newer version of Hoop Stats. Update the app, then try again.';
    expect(rejection({ ...file(), schemaVersion: 2 }).message).toBe(UPDATE);

    // What a newer version might add: a new field, a new stat type, a looser limit.
    const newer = {
      ...file({ events: [event({ type: 'dunk' as 'ast' })] }),
      games: [{ ...game({ opponent: 'O'.repeat(500) }), venue: 'Main gym' }],
      schemaVersion: 2,
      teams: [{ id: 't1' }],
    };
    expect(rejection(newer).message).toBe(UPDATE);
    expect(rejection(JSON.stringify(newer)).message).toBe(UPDATE);
  });

  it.each([
    ['a missing schema version', { ...file(), schemaVersion: undefined }, 'schemaVersion'],
    ['a text schema version', { ...file(), schemaVersion: '1' }, 'schemaVersion'],
    ['missing games', { ...file(), games: undefined }, 'games'],
    ['a bad date', file({ games: [game({ date: '2026-02-30' })] }), 'games[0].date'],
    ['a bad status', file({ games: [game({ status: 'paused' as 'live' })] }), 'games[0].status'],
    ['a negative score', file({ games: [game({ teamScore: -1 })] }), 'games[0].teamScore'],
    ['a runaway period', file({ games: [game({ currentPeriod: 99 })] }), 'currentPeriod'],
    ['an unknown stat', file({ events: [event({ type: 'dunk' as 'ast' })] }), 'events[0].type'],
    ['a fractional period', file({ events: [event({ period: 1.5 })] }), 'events[0].period'],
    [
      'a location on a free throw',
      file({ events: [event({ type: 'ft_made', location: { x: 0, y: 13.75 } })] }),
      'events[0].location',
    ],
    [
      'a location off the court',
      file({ events: [event({ type: 'fg3_made', location: { x: 0, y: 80 } })] }),
      'events[0].location.y',
    ],
    ['a missing id', file({ events: [event({ id: '' })] }), 'events[0].id'],
    [
      'a text timestamp',
      file({ players: [{ ...player, createdAt: 'now' as unknown as number }] }),
      'players[0].createdAt',
    ],
    [
      'bad settings',
      file({ settings: { shotChart: 1 as unknown as boolean, defaultPeriodFormat: 'quarters' } }),
      'settings.shotChart',
    ],
    [
      'a stat for a missing game',
      file({ events: [event({ gameId: 'g9' })] }),
      'No game with id g9',
    ],
    [
      'a game for a missing player',
      file({ games: [game({ playerId: 'p9' })] }),
      'No player with id p9',
    ],
    ['duplicate games', file({ games: [game(), game()] }), 'games[1].id: Duplicate id g1'],
    ['duplicate events', file({ events: [event(), event()] }), 'events[1].id: Duplicate id e1'],
  ])('rejects %s as damaged', (_, input, detail) => {
    const error = rejection(input);
    expect(error.message).toBe(DAMAGED);
    expect(error.details.join('\n')).toContain(detail);
  });
});

describe('clearAllData', () => {
  it('deletes the data and settings, keeping other device records', async () => {
    await seedWithRepo();
    await db.meta.put({ key: 'backup', value: { enabled: true } });
    const before = await getLastChangeAt();

    await clearAllData();
    expect(await exportAll()).toMatchObject({ players: [], games: [], events: [] });
    expect(await db.meta.get(META_KEYS.settings)).toBeUndefined();
    expect(await db.meta.get('backup')).toEqual({ key: 'backup', value: { enabled: true } });
    expect(await getLastChangeAt()).toBeGreaterThan(before ?? 0);
  });
});
