import { afterEach, describe, expect, it, vi } from 'vitest';
import { db, META_KEYS } from './db';
import {
  createGame,
  DEFAULT_SETTINGS,
  deleteGame,
  deleteStat,
  endGame,
  getAllEvents,
  getGame,
  getGameEvents,
  getLastChangeAt,
  getLiveGame,
  getPlayer,
  getSettings,
  listGames,
  listSeasons,
  primaryPlayer,
  recordStat,
  reopenGame,
  savePlayer,
  setCurrentPeriod,
  setStatLocation,
  subscribeToChanges,
  undoLastStat,
  updateGame,
  updateSettings,
  type NewGame,
} from './repo';
import { MAX_PERIOD, type Game, type Player, type StatEvent } from './types';

const T0 = new Date(2026, 8, 27, 18, 0).getTime();

/** Freezes Date.now() (only Date: IndexedDB still needs real timers). */
function freezeClock(at = T0) {
  vi.useFakeTimers({ toFake: ['Date'], now: at });
}

afterEach(() => {
  vi.useRealTimers();
});

function newGame(overrides: Partial<NewGame> = {}): Promise<Game> {
  return createGame({
    opponent: 'Lincoln',
    date: '2026-09-27',
    periodFormat: 'quarters',
    ...overrides,
  });
}

async function mustGetGame(id: string): Promise<Game> {
  const game = await getGame(id);
  if (!game) throw new Error(`missing game ${id}`);
  return game;
}

describe('player', () => {
  it('starts with no player', async () => {
    expect(await getPlayer()).toBeUndefined();
  });

  it('creates the player, then updates the same one', async () => {
    freezeClock();
    const created = await savePlayer({ name: '  Ava ', jerseyNumber: ' 12 ' });
    expect(created).toEqual({
      id: expect.any(String) as string,
      name: 'Ava',
      jerseyNumber: '12',
      createdAt: T0,
      updatedAt: T0,
    });

    const updated = await savePlayer({ name: 'Ava S.' });
    expect(updated).toEqual({
      id: created.id,
      name: 'Ava S.',
      jerseyNumber: '12',
      createdAt: T0,
      updatedAt: T0 + 1,
    });
    expect(await getPlayer()).toEqual(updated);
    expect(await db.players.count()).toBe(1);
  });

  it('keeps the jersey number when it is left out, and clears it with null or ""', async () => {
    await savePlayer({ name: 'Ava', jerseyNumber: '12' });
    expect((await savePlayer({ name: 'Ava' })).jerseyNumber).toBe('12');
    expect((await savePlayer({ name: 'Ava', jerseyNumber: undefined })).jerseyNumber).toBe('12');
    expect(await savePlayer({ name: 'Ava', jerseyNumber: '' })).not.toHaveProperty('jerseyNumber');

    await savePlayer({ name: 'Ava', jerseyNumber: '3' });
    expect(await savePlayer({ name: 'Ava', jerseyNumber: null })).not.toHaveProperty(
      'jerseyNumber',
    );
    expect(await getPlayer()).not.toHaveProperty('jerseyNumber');
  });

  it('rejects a name that is too long', async () => {
    await expect(savePlayer({ name: 'A'.repeat(81) })).rejects.toThrow(TypeError);
    expect(await getPlayer()).toBeUndefined();
  });

  it('counts the first-created player if there are several', () => {
    const player = (id: string, createdAt: number): Player => ({
      id,
      name: id,
      createdAt,
      updatedAt: createdAt,
    });
    expect(primaryPlayer([player('b', 2), player('a', 1), player('c', 1)])?.id).toBe('a');
    expect(primaryPlayer([])).toBeUndefined();
  });
});

describe('createGame', () => {
  it('starts a live game in period 1 for the player', async () => {
    freezeClock();
    const player = await savePlayer({ name: 'Ava' });
    const game = await newGame({ season: 'Fall 2026', homeAway: 'home' });
    expect(game).toEqual({
      id: expect.any(String) as string,
      playerId: player.id,
      opponent: 'Lincoln',
      date: '2026-09-27',
      season: 'Fall 2026',
      homeAway: 'home',
      periodFormat: 'quarters',
      currentPeriod: 1,
      status: 'live',
      createdAt: T0,
      updatedAt: T0,
    });
    expect(await getGame(game.id)).toEqual(game);
  });

  it('creates an unnamed player if none was set up', async () => {
    const game = await newGame();
    const player = await getPlayer();
    expect(player).toMatchObject({ id: game.playerId, name: '' });

    // A later game uses the same player.
    expect((await newGame()).playerId).toBe(game.playerId);
    expect(await db.players.count()).toBe(1);
  });

  it('trims text and leaves out empty optional fields', async () => {
    const game = await newGame({ opponent: '  Oak Ridge ', season: '   ', homeAway: null });
    expect(game.opponent).toBe('Oak Ridge');
    expect(game).not.toHaveProperty('season');
    expect(game).not.toHaveProperty('homeAway');
  });

  it('remembers the format and season for the next game', async () => {
    await newGame({ periodFormat: 'halves', season: ' Fall 2026 ' });
    expect(await getSettings()).toEqual({
      shotChart: true,
      defaultPeriodFormat: 'halves',
      lastSeason: 'Fall 2026',
    });

    // A game without a season keeps the remembered one.
    await newGame({ periodFormat: 'quarters' });
    expect(await getSettings()).toMatchObject({
      defaultPeriodFormat: 'quarters',
      lastSeason: 'Fall 2026',
    });
  });

  it('rejects bad input and writes nothing', async () => {
    await expect(newGame({ opponent: '  ' })).rejects.toThrow(/opponent/);
    await expect(newGame({ date: '2026-02-30' })).rejects.toThrow(/date/);
    await expect(newGame({ date: '09/27/2026' })).rejects.toThrow(TypeError);
    await expect(newGame({ periodFormat: 'thirds' as 'quarters' })).rejects.toThrow(TypeError);
    expect(await db.games.count()).toBe(0);
    // The player the failed game would have created was rolled back too.
    expect(await getPlayer()).toBeUndefined();
    expect(await getLastChangeAt()).toBeUndefined();
  });
});

describe('updateGame', () => {
  it('changes only the fields given, and clears optional ones with null', async () => {
    const game = await newGame({ season: 'Fall 2026', homeAway: 'away' });
    const updated = await updateGame(game.id, {
      opponent: ' Westview ',
      teamScore: 40,
      opponentScore: 38,
      notes: '  Great game ',
      homeAway: null,
    });
    expect(updated).toMatchObject({
      opponent: 'Westview',
      season: 'Fall 2026',
      teamScore: 40,
      opponentScore: 38,
      notes: 'Great game',
    });
    expect(updated).not.toHaveProperty('homeAway');
    expect(await getGame(game.id)).toEqual(updated);
  });

  it('keeps every field that is undefined', async () => {
    freezeClock();
    const game = await newGame({ season: 'Fall 2026', homeAway: 'home' });
    await updateGame(game.id, { teamScore: 40, opponentScore: 38, notes: 'Close one' });
    const kept = await updateGame(game.id, {
      opponent: undefined,
      date: undefined,
      season: undefined,
      homeAway: undefined,
      periodFormat: undefined,
      teamScore: undefined,
      opponentScore: undefined,
      notes: undefined,
    });
    expect(kept).toEqual({
      ...game,
      teamScore: 40,
      opponentScore: 38,
      notes: 'Close one',
      updatedAt: T0 + 2,
    });
  });

  it('clears optional fields with null or ""', async () => {
    const game = await newGame({ season: 'Fall 2026', homeAway: 'home' });
    await updateGame(game.id, { teamScore: 40, opponentScore: 38, notes: 'Close one' });
    const cleared = await updateGame(game.id, {
      season: '',
      homeAway: '' as unknown as null,
      teamScore: null,
      opponentScore: '' as unknown as null,
      notes: '  ',
    });
    for (const field of ['season', 'homeAway', 'teamScore', 'opponentScore', 'notes']) {
      expect(cleared, field).not.toHaveProperty(field);
    }
    const again = await updateGame(game.id, { notes: 'x', season: 'JV' });
    expect(await updateGame(game.id, { notes: null, season: null })).toEqual({
      ...again,
      notes: undefined,
      season: undefined,
      updatedAt: expect.any(Number) as number,
    });
  });

  it("can't clear a required field", async () => {
    const game = await newGame();
    await expect(updateGame(game.id, { opponent: null as unknown as string })).rejects.toThrow(
      /opponent/,
    );
    await expect(updateGame(game.id, { date: '' })).rejects.toThrow(/date/);
    expect(await getGame(game.id)).toEqual(game);
  });

  it('bumps updatedAt, even within the same millisecond', async () => {
    freezeClock();
    const game = await newGame();
    const first = await updateGame(game.id, { notes: 'a' });
    const second = await updateGame(game.id, { notes: 'b' });
    expect(first.updatedAt).toBe(T0 + 1);
    expect(second.updatedAt).toBe(T0 + 2);
    expect(second.createdAt).toBe(T0);
  });

  it('rejects invalid values and keeps the game as it was', async () => {
    const game = await newGame();
    await expect(updateGame(game.id, { teamScore: -1 })).rejects.toThrow(/teamScore/);
    await expect(updateGame(game.id, { opponentScore: 2.5 })).rejects.toThrow(TypeError);
    await expect(updateGame(game.id, { date: 'tomorrow' })).rejects.toThrow(/date/);
    await expect(updateGame(game.id, { opponent: '' })).rejects.toThrow(/opponent/);
    expect(await getGame(game.id)).toEqual(game);
  });

  it('rejects a game that does not exist', async () => {
    await expect(updateGame('nope', { notes: 'x' })).rejects.toThrow('Game not found: nope');
  });
});

describe('setCurrentPeriod', () => {
  it('moves the game to another period, including overtime', async () => {
    const game = await newGame();
    expect((await setCurrentPeriod(game.id, 5)).currentPeriod).toBe(5);
    expect((await setCurrentPeriod(game.id, 2)).currentPeriod).toBe(2);
  });

  it('rejects periods out of range', async () => {
    const game = await newGame();
    for (const period of [0, -1, 1.5, MAX_PERIOD + 1, Number.NaN]) {
      await expect(setCurrentPeriod(game.id, period), String(period)).rejects.toThrow(TypeError);
    }
    expect((await mustGetGame(game.id)).currentPeriod).toBe(1);
  });
});

describe('recordStat', () => {
  it("records stats in the game's current period", async () => {
    freezeClock();
    const game = await newGame();
    const first = await recordStat(game.id, 'fg2_made');
    await setCurrentPeriod(game.id, 2);
    const second = await recordStat(game.id, 'ast');

    expect(first).toEqual({
      id: expect.any(String) as string,
      gameId: game.id,
      type: 'fg2_made',
      period: 1,
      createdAt: T0,
    });
    expect(second.period).toBe(2);
    expect(await getGameEvents(game.id)).toEqual([first, second]);
  });

  it('records into the period it is given, without changing the current one', async () => {
    const game = await newGame();
    await setCurrentPeriod(game.id, 3);
    const earlier = await recordStat(game.id, 'stl', undefined, { period: 2 });
    const overtime = await recordStat(game.id, 'fg3_made', { x: 0, y: 25 }, { period: 5 });
    const current = await recordStat(game.id, 'ast', undefined, {});
    expect([earlier.period, overtime.period, current.period]).toEqual([2, 5, 3]);
    expect(overtime.location).toEqual({ x: 0, y: 25 });
    expect((await mustGetGame(game.id)).currentPeriod).toBe(3);
    expect((await getGameEvents(game.id)).map((e) => e.period)).toEqual([2, 5, 3]);
  });

  it('rejects a period out of range, like setCurrentPeriod, and saves nothing', async () => {
    const game = await newGame();
    for (const period of [0, -1, 1.5, MAX_PERIOD + 1, Number.NaN]) {
      await expect(
        recordStat(game.id, 'ast', undefined, { period }),
        String(period),
      ).rejects.toThrow(TypeError);
    }
    expect(await getGameEvents(game.id)).toEqual([]);
    const last = await recordStat(game.id, 'ast', undefined, { period: MAX_PERIOD });
    expect(last.period).toBe(MAX_PERIOD);
  });

  it('keeps taps in the same millisecond in order', async () => {
    freezeClock();
    const game = await newGame();
    const taps: StatEvent[] = [];
    for (const type of ['fg2_miss', 'oreb', 'fg2_made', 'foul'] as const) {
      taps.push(await recordStat(game.id, type));
    }
    expect(taps.map((tap) => tap.createdAt)).toEqual([T0, T0 + 1, T0 + 2, T0 + 3]);
    expect((await getGameEvents(game.id)).map((e) => e.type)).toEqual([
      'fg2_miss',
      'oreb',
      'fg2_made',
      'foul',
    ]);
  });

  it('keeps rapid taps in tap order without waiting for each save', async () => {
    freezeClock();
    const game = await newGame();
    const types = ['stl', 'fg3_miss', 'dreb', 'ast', 'tov', 'deflection'] as const;
    const recorded = await Promise.all(types.map((type) => recordStat(game.id, type)));
    expect(recorded.map((e) => e.createdAt)).toEqual(types.map((_, index) => T0 + index));
    expect((await getGameEvents(game.id)).map((e) => e.type)).toEqual([...types]);
  });

  it('keeps order if the clock goes backwards', async () => {
    freezeClock(T0);
    const game = await newGame();
    const first = await recordStat(game.id, 'blk');
    vi.setSystemTime(T0 - 60_000);
    const second = await recordStat(game.id, 'charge');
    expect(second.createdAt).toBe(first.createdAt + 1);
  });

  it('stores shot locations on 2PT and 3PT shots', async () => {
    const game = await newGame();
    const two = await recordStat(game.id, 'fg2_made', { x: 3.5, y: 4 });
    const three = await recordStat(game.id, 'fg3_miss', { x: -22, y: -2 });
    expect(two.location).toEqual({ x: 3.5, y: 4 });
    expect(three.location).toEqual({ x: -22, y: -2 });
    expect((await getGameEvents(game.id)).map((e) => e.location)).toEqual([
      { x: 3.5, y: 4 },
      { x: -22, y: -2 },
    ]);
  });

  it('clamps shot locations onto the half court', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg3_made', { x: 27, y: -6 });
    expect(shot.location).toEqual({ x: 25, y: -5.25 });
  });

  it('stores -0 as 0, which a JSON backup keeps', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg2_made', { x: -0, y: 4 });
    expect(Object.is(shot.location?.x, 0)).toBe(true);
  });

  it('treats a null location as none', async () => {
    const game = await newGame();
    expect(await recordStat(game.id, 'ft_made', null)).not.toHaveProperty('location');
    expect(await recordStat(game.id, 'fg2_miss', null)).not.toHaveProperty('location');
  });

  it('rejects a location on anything but a 2PT or 3PT shot', async () => {
    const game = await newGame();
    for (const type of ['ft_made', 'ft_miss', 'oreb', 'ast', 'charge'] as const) {
      await expect(recordStat(game.id, type, { x: 0, y: 10 }), type).rejects.toThrow(
        /Only 2PT and 3PT shots can have a location/,
      );
    }
    expect(await getGameEvents(game.id)).toEqual([]);
  });

  it('rejects bad input', async () => {
    const game = await newGame();
    await expect(recordStat(game.id, 'dunk' as 'ast')).rejects.toThrow('Unknown stat type: dunk');
    await expect(recordStat('nope', 'ast')).rejects.toThrow('Game not found: nope');
    expect(await getAllEvents()).toEqual([]);
  });

  it("keeps the tap when the location isn't a real point", async () => {
    // e.g. a tap measured on a court drawn at zero size.
    const game = await newGame();
    const nan = await recordStat(game.id, 'fg2_made', { x: Number.NaN, y: 3 });
    const infinite = await recordStat(game.id, 'fg3_miss', { x: 4, y: Infinity });
    expect(nan).not.toHaveProperty('location');
    expect(infinite).not.toHaveProperty('location');
    expect((await getGameEvents(game.id)).map((e) => e.type)).toEqual(['fg2_made', 'fg3_miss']);
  });

  it('bumps the game updatedAt', async () => {
    freezeClock();
    const game = await newGame();
    await recordStat(game.id, 'ast');
    await recordStat(game.id, 'ast');
    expect((await mustGetGame(game.id)).updatedAt).toBe(T0 + 2);
  });
});

describe('setStatLocation', () => {
  it('adds, moves and removes the location of a recorded shot', async () => {
    freezeClock();
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg3_made');

    const placed = await setStatLocation(shot.id, { x: -21, y: 8 });
    expect(placed).toEqual({ ...shot, location: { x: -21, y: 8 } });
    expect(await getGameEvents(game.id)).toEqual([placed]);

    const moved = await setStatLocation(shot.id, { x: 0, y: 40 });
    expect(moved?.location).toEqual({ x: 0, y: 36.75 });

    const removed = await setStatLocation(shot.id, null);
    expect(removed).toEqual(shot);
    expect((await mustGetGame(game.id)).updatedAt).toBe(T0 + 4);
  });

  it('only places 2PT and 3PT shots', async () => {
    const game = await newGame();
    const freeThrow = await recordStat(game.id, 'ft_made');
    await expect(setStatLocation(freeThrow.id, { x: 0, y: 13.75 })).rejects.toThrow(TypeError);
    expect(await getGameEvents(game.id)).toEqual([freeThrow]);
  });

  it("rejects a point that isn't real and keeps the stat as it was", async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg2_made', { x: 1, y: 2 });
    await expect(setStatLocation(shot.id, { x: Number.NaN, y: 2 })).rejects.toThrow(TypeError);
    expect(await getGameEvents(game.id)).toEqual([shot]);
  });

  it('keeps the location when it is undefined', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg2_made', { x: 1, y: 2 });
    const before = await getLastChangeAt();
    expect(await setStatLocation(shot.id, undefined as unknown as null)).toEqual(shot);
    expect(await getLastChangeAt()).toBe(before);
  });

  it('resolves to undefined for a stat that is gone', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg2_miss');
    await undoLastStat(game.id);
    const before = await getLastChangeAt();
    expect(await setStatLocation(shot.id, { x: 1, y: 1 })).toBeUndefined();
    expect(await getGameEvents(game.id)).toEqual([]);
    expect(await getLastChangeAt()).toBe(before);
  });
});

describe('undoLastStat and deleteStat', () => {
  it('undoes the most recent stat, even among same-millisecond taps', async () => {
    freezeClock();
    const game = await newGame();
    const a = await recordStat(game.id, 'fg2_made');
    const b = await recordStat(game.id, 'fg2_miss');
    const c = await recordStat(game.id, 'oreb');

    expect(await undoLastStat(game.id)).toEqual(c);
    expect(await undoLastStat(game.id)).toEqual(b);
    expect(await getGameEvents(game.id)).toEqual([a]);
    expect(await undoLastStat(game.id)).toEqual(a);
    expect(await undoLastStat(game.id)).toBeUndefined();
  });

  it("only touches that game's stats", async () => {
    const one = await newGame();
    const two = await newGame({ opponent: 'Roosevelt' });
    const keep = await recordStat(one.id, 'stl');
    await recordStat(two.id, 'blk');
    await undoLastStat(two.id);
    expect(await getAllEvents()).toEqual([keep]);
  });

  it('deletes one stat by id', async () => {
    const game = await newGame();
    const a = await recordStat(game.id, 'ast');
    const b = await recordStat(game.id, 'tov');
    const c = await recordStat(game.id, 'stl');
    expect(await deleteStat(b.id)).toEqual(b);
    expect(await getGameEvents(game.id)).toEqual([a, c]);
    expect(await deleteStat(b.id)).toBeUndefined();
  });

  it('bumps the game updatedAt', async () => {
    freezeClock();
    const game = await newGame();
    const stat = await recordStat(game.id, 'ast');
    await recordStat(game.id, 'ast');
    await undoLastStat(game.id);
    expect((await mustGetGame(game.id)).updatedAt).toBe(T0 + 3);
    await deleteStat(stat.id);
    expect((await mustGetGame(game.id)).updatedAt).toBe(T0 + 4);
  });
});

describe('endGame and reopenGame', () => {
  it('ends a game with the final score', async () => {
    freezeClock();
    const game = await newGame();
    const ended = await endGame(game.id, { teamScore: 44, opponentScore: 39 });
    expect(ended).toMatchObject({
      status: 'final',
      endedAt: T0,
      teamScore: 44,
      opponentScore: 39,
      updatedAt: T0 + 1,
    });
    expect(await getGame(game.id)).toEqual(ended);
  });

  it('keeps scores that are left out, and the first end time', async () => {
    freezeClock();
    const game = await newGame();
    await updateGame(game.id, { teamScore: 20 });
    const ended = await endGame(game.id);
    expect(ended).toMatchObject({ status: 'final', teamScore: 20 });
    expect(ended).not.toHaveProperty('opponentScore');

    vi.setSystemTime(T0 + 60_000);
    const kept = await endGame(game.id, { teamScore: undefined, opponentScore: 18 });
    expect(kept).toMatchObject({ teamScore: 20, opponentScore: 18, endedAt: T0 });

    const edited = await endGame(game.id, { teamScore: null });
    expect(edited.opponentScore).toBe(18);
    expect(edited).not.toHaveProperty('teamScore');
  });

  it('rejects invalid scores', async () => {
    const game = await newGame();
    await expect(endGame(game.id, { teamScore: -4 })).rejects.toThrow(TypeError);
    expect((await mustGetGame(game.id)).status).toBe('live');
  });

  it('reopens a final game and keeps its scores', async () => {
    const game = await newGame();
    await endGame(game.id, { teamScore: 44, opponentScore: 39 });
    const reopened = await reopenGame(game.id);
    expect(reopened).toMatchObject({ status: 'live', teamScore: 44, opponentScore: 39 });
    expect(reopened).not.toHaveProperty('endedAt');
    expect(await getGame(game.id)).toEqual(reopened);
  });
});

describe('deleteGame', () => {
  it('deletes the game and its stats, and nothing else', async () => {
    const doomed = await newGame();
    const kept = await newGame({ opponent: 'Roosevelt' });
    await recordStat(doomed.id, 'ast');
    await recordStat(doomed.id, 'stl');
    const keptStat = await recordStat(kept.id, 'blk');

    await deleteGame(doomed.id);
    expect(await getGame(doomed.id)).toBeUndefined();
    expect(await getGameEvents(doomed.id)).toEqual([]);
    expect(await listGames()).toEqual([await mustGetGame(kept.id)]);
    expect(await getAllEvents()).toEqual([keptStat]);
  });

  it('does nothing for a game that does not exist', async () => {
    await newGame();
    const before = await getLastChangeAt();
    await deleteGame('nope');
    expect(await getLastChangeAt()).toBe(before);
  });
});

describe('queries', () => {
  it('lists games newest first: by date, then by creation', async () => {
    freezeClock(T0);
    const a = await newGame({ opponent: 'A', date: '2026-09-20' });
    vi.setSystemTime(T0 + 1000);
    const b = await newGame({ opponent: 'B', date: '2026-09-27' });
    vi.setSystemTime(T0 + 2000);
    const c = await newGame({ opponent: 'C', date: '2026-09-20' });
    vi.setSystemTime(T0 + 3000);
    const d = await newGame({ opponent: 'D', date: '2026-10-01' });
    expect((await listGames()).map((g) => g.opponent)).toEqual(['D', 'B', 'C', 'A']);
    expect([a, b, c, d].every((g) => g.status === 'live')).toBe(true);
  });

  it('finds the live game updated most recently', async () => {
    expect(await getLiveGame()).toBeUndefined();

    freezeClock(T0);
    const older = await newGame({ opponent: 'Older' });
    vi.setSystemTime(T0 + 1000);
    const newer = await newGame({ opponent: 'Newer' });
    expect((await getLiveGame())?.id).toBe(newer.id);

    vi.setSystemTime(T0 + 2000);
    await recordStat(older.id, 'ast');
    expect((await getLiveGame())?.id).toBe(older.id);

    await endGame(older.id);
    expect((await getLiveGame())?.id).toBe(newer.id);
    await endGame(newer.id);
    expect(await getLiveGame()).toBeUndefined();
  });

  it('lists distinct seasons, most recent first', async () => {
    await newGame({ date: '2025-12-01', season: 'Winter 2025' });
    await newGame({ date: '2026-09-01', season: 'Fall 2026' });
    await newGame({ date: '2026-03-01', season: 'Spring 2026' });
    await newGame({ date: '2026-09-10' });
    await newGame({ date: '2025-11-01', season: 'Fall 2026' });
    expect(await listSeasons()).toEqual(['Fall 2026', 'Spring 2026', 'Winter 2025']);
  });

  it("lists every game's events, grouped by game and oldest first", async () => {
    freezeClock();
    const one = await newGame();
    const two = await newGame();
    const e1 = await recordStat(one.id, 'ast');
    const e2 = await recordStat(two.id, 'stl');
    const e3 = await recordStat(one.id, 'blk');
    const all = await getAllEvents();
    expect(all).toHaveLength(3);
    expect(all.filter((e) => e.gameId === one.id)).toEqual([e1, e3]);
    expect(all.filter((e) => e.gameId === two.id)).toEqual([e2]);
  });
});

describe('settings', () => {
  it('has defaults', async () => {
    expect(await getSettings()).toEqual({ shotChart: true, defaultPeriodFormat: 'quarters' });
    expect(DEFAULT_SETTINGS).toEqual({ shotChart: true, defaultPeriodFormat: 'quarters' });
  });

  it('updates only the settings given', async () => {
    expect(await updateSettings({ shotChart: false })).toEqual({
      shotChart: false,
      defaultPeriodFormat: 'quarters',
    });
    await updateSettings({ lastSeason: ' JV Winter ', defaultPeriodFormat: 'halves' });
    expect(await getSettings()).toEqual({
      shotChart: false,
      defaultPeriodFormat: 'halves',
      lastSeason: 'JV Winter',
    });
    await updateSettings({ lastSeason: null });
    expect(await getSettings()).toEqual({ shotChart: false, defaultPeriodFormat: 'halves' });
  });

  it('keeps a setting that is undefined, and clears lastSeason with null or ""', async () => {
    await updateSettings({ shotChart: false, lastSeason: 'JV' });
    await updateSettings({ shotChart: undefined, lastSeason: undefined });
    expect(await getSettings()).toEqual({
      shotChart: false,
      defaultPeriodFormat: 'quarters',
      lastSeason: 'JV',
    });
    await updateSettings({ lastSeason: '' });
    expect(await getSettings()).toEqual({ shotChart: false, defaultPeriodFormat: 'quarters' });
  });

  it('rejects invalid values', async () => {
    await expect(updateSettings({ shotChart: 'yes' as unknown as boolean })).rejects.toThrow(
      TypeError,
    );
    await expect(updateSettings({ defaultPeriodFormat: 'thirds' as 'halves' })).rejects.toThrow(
      TypeError,
    );
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to the default for each unreadable stored value', async () => {
    await db.meta.put({
      key: META_KEYS.settings,
      value: { shotChart: 'no', defaultPeriodFormat: 'halves', lastSeason: 7 },
    });
    expect(await getSettings()).toEqual({ shotChart: true, defaultPeriodFormat: 'halves' });
    await db.meta.put({
      key: META_KEYS.settings,
      value: { shotChart: false, defaultPeriodFormat: 'thirds', lastSeason: '' },
    });
    expect(await getSettings()).toEqual({ shotChart: false, defaultPeriodFormat: 'quarters' });
    await db.meta.put({ key: META_KEYS.settings, value: { lastSeason: 'S'.repeat(61) } });
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await db.meta.put({ key: META_KEYS.settings, value: 'garbage' });
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads exactly the settings the schema knows', async () => {
    await db.meta.put({
      key: META_KEYS.settings,
      value: { shotChart: false, lastSeason: 'JV', theme: 'dark' },
    });
    expect(await getSettings()).toEqual({
      shotChart: false,
      defaultPeriodFormat: 'quarters',
      lastSeason: 'JV',
    });
  });
});

describe('lastChangeAt', () => {
  it('is bumped by every write, strictly increasing within one millisecond', async () => {
    freezeClock();
    expect(await getLastChangeAt()).toBeUndefined();

    let game: Game | undefined;
    let stat: StatEvent | undefined;
    const gameId = () => game?.id ?? '';
    const writes: [string, () => Promise<unknown>][] = [
      ['savePlayer', () => savePlayer({ name: 'Ava' })],
      ['createGame', async () => (game = await newGame())],
      ['updateGame', () => updateGame(gameId(), { notes: 'Rivalry game' })],
      ['setCurrentPeriod', () => setCurrentPeriod(gameId(), 2)],
      ['recordStat', async () => (stat = await recordStat(gameId(), 'fg2_made'))],
      ['setStatLocation', () => setStatLocation(stat?.id ?? '', { x: 2, y: 3 })],
      ['recordStat again', () => recordStat(gameId(), 'stl')],
      ['undoLastStat', () => undoLastStat(gameId())],
      ['deleteStat', () => deleteStat(stat?.id ?? '')],
      ['endGame', () => endGame(gameId(), { teamScore: 40, opponentScore: 30 })],
      ['reopenGame', () => reopenGame(gameId())],
      ['updateSettings', () => updateSettings({ shotChart: false })],
      ['deleteGame', () => deleteGame(gameId())],
    ];

    let previous = -Infinity;
    for (const [name, write] of writes) {
      await write();
      const current = await getLastChangeAt();
      expect(current, name).toBeGreaterThan(previous);
      previous = current ?? previous;
    }
    expect(previous).toBe(T0 + writes.length - 1);
  });

  it('is not bumped when nothing changes', async () => {
    const game = await newGame();
    const before = await getLastChangeAt();
    expect(await undoLastStat(game.id)).toBeUndefined();
    expect(await deleteStat('nope')).toBeUndefined();
    await expect(recordStat(game.id, 'ast', { x: 0, y: 0 })).rejects.toThrow();
    await expect(updateGame(game.id, { teamScore: -1 })).rejects.toThrow();
    expect(await getLastChangeAt()).toBe(before);
  });
});

describe('subscribeToChanges', () => {
  it('hears every write as soon as it commits, until stopped', async () => {
    const listener = vi.fn();
    const stop = subscribeToChanges(listener);

    await savePlayer({ name: 'Ava' });
    // Already heard when the write resolves: nothing has had a chance to re-read yet.
    expect(listener).toHaveBeenCalledTimes(1);
    const game = await newGame();
    await deleteGame(game.id);
    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    await savePlayer({ name: 'Ava Grace' });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('stays quiet for reads', async () => {
    const listener = vi.fn();
    const stop = subscribeToChanges(listener);
    await Promise.all([getPlayer(), listGames(), getSettings(), getLastChangeAt()]);
    stop();
    expect(listener).not.toHaveBeenCalled();
  });
});
