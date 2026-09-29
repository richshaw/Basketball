import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPendingStat,
  isPendingStat,
  listPendingStats,
  newPendingStat,
  removePendingStat,
  replayPendingStats,
  savePendingStat,
  type PendingStat,
} from './pendingStats';
import * as repo from './repo';
import { createGame, deleteGame, endGame, getAllEvents, getGameEvents, type NewGame } from './repo';
import type { Game } from './types';

const T0 = new Date(2026, 8, 27, 18, 0).getTime();
const KEY_PREFIX = 'hoop-stats.pendingStat.';

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

function stat(overrides: Partial<PendingStat> = {}): PendingStat {
  return { id: 'tap-1', gameId: 'game-1', type: 'stl', period: 2, at: T0, ...overrides };
}

/** The journal's own keys in localStorage. */
function journalKeys(): string[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(KEY_PREFIX))
    .sort();
}

describe('the pending-stats journal', () => {
  it('keeps each tap under its own key until it is forgotten', () => {
    const steal = stat({ id: 'a', at: T0 + 20 });
    const shot = stat({ id: 'b', type: 'fg3_made', at: T0 + 10, location: { x: -20, y: 8 } });
    expect(addPendingStat(steal)).toBe(true);
    expect(addPendingStat(shot)).toBe(true);

    expect(journalKeys()).toEqual([`${KEY_PREFIX}a`, `${KEY_PREFIX}b`]);
    // In tap order.
    expect(listPendingStats()).toEqual([shot, steal]);
    expect(isPendingStat('a')).toBe(true);

    removePendingStat('a');
    expect(journalKeys()).toEqual([`${KEY_PREFIX}b`]);
    expect(isPendingStat('a')).toBe(false);
    expect(listPendingStats()).toEqual([shot]);
    removePendingStat('not-kept');
    expect(listPendingStats()).toEqual([shot]);
  });

  it("lists one game's taps", () => {
    addPendingStat(stat({ id: 'a', gameId: 'game-1' }));
    addPendingStat(stat({ id: 'b', gameId: 'game-2' }));
    expect(listPendingStats('game-2').map((each) => each.id)).toEqual(['b']);
    expect(listPendingStats('game-3')).toEqual([]);
  });

  it('gives each new tap its own id, and a tap time after the one given', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
    const first = newPendingStat({ gameId: 'game-1', type: 'ast', period: 1 });
    const second = newPendingStat({ gameId: 'game-1', type: 'ast', period: 1 }, first.at);
    const shot = newPendingStat(
      { gameId: 'game-1', type: 'fg2_made', period: 3, location: { x: 1, y: 2 } },
      T0 + 500,
    );
    expect(first).toEqual({
      id: expect.any(String) as string,
      gameId: 'game-1',
      type: 'ast',
      period: 1,
      at: T0,
    });
    expect(second.at).toBe(T0 + 1);
    expect(shot).toMatchObject({ period: 3, at: T0 + 501, location: { x: 1, y: 2 } });
    expect(new Set([first.id, second.id, shot.id]).size).toBe(3);
  });

  it("skips entries it can't save, and leaves them (and other keys) alone", () => {
    const good = stat({ id: 'good' });
    addPendingStat(good);
    const unreadable = {
      [`${KEY_PREFIX}garbled`]: '{"id":',
      [`${KEY_PREFIX}null`]: 'null',
      [`${KEY_PREFIX}other-key`]: JSON.stringify(stat({ id: 'mismatch' })),
      [`${KEY_PREFIX}dunk`]: JSON.stringify(stat({ id: 'dunk', type: 'dunk' as 'stl' })),
      [`${KEY_PREFIX}period`]: JSON.stringify(stat({ id: 'period', period: 0 })),
      [`${KEY_PREFIX}time`]: JSON.stringify(stat({ id: 'time', at: 1.5 })),
    };
    for (const [key, value] of Object.entries(unreadable)) localStorage.setItem(key, value);
    localStorage.setItem('hoop-stats.lastBackupFile', '{}');

    expect(listPendingStats()).toEqual([good]);
    expect(Object.keys(localStorage)).toHaveLength(Object.keys(unreadable).length + 2);
  });

  it('drops a location that could never be saved, but never the tap', () => {
    localStorage.setItem(
      `${KEY_PREFIX}nan`,
      // NaN can't be written as JSON: it comes back as null.
      JSON.stringify(stat({ id: 'nan', type: 'fg2_made', location: { x: Number.NaN, y: 3 } })),
    );
    addPendingStat(stat({ id: 'ft', type: 'ft_made', location: { x: 0, y: 13.75 } }));
    expect(listPendingStats()).toEqual([
      stat({ id: 'ft', type: 'ft_made' }),
      stat({ id: 'nan', type: 'fg2_made' }),
    ]);
  });

  it('carries on when localStorage throws: full, or blocked altogether', () => {
    addPendingStat(stat({ id: 'kept' }));
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(addPendingStat(stat({ id: 'not-kept' }))).toBe(false);
    expect(listPendingStats().map((each) => each.id)).toEqual(['kept']);
    full.mockRestore();

    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(addPendingStat(stat({ id: 'blocked' }))).toBe(false);
    expect(isPendingStat('kept')).toBe(false);
    expect(listPendingStats()).toEqual([]);
    expect(() => removePendingStat('kept')).not.toThrow();
  });
});

describe('replayPendingStats', () => {
  it('saves each kept tap once, in its period at its tap time, and forgets it', async () => {
    const game = await newGame();
    const steal = stat({ id: 'a', gameId: game.id, at: T0 + 10, period: 2 });
    const shot = stat({
      id: 'b',
      gameId: game.id,
      type: 'fg3_miss',
      at: T0,
      period: 3,
      location: { x: 22, y: 1 },
    });
    addPendingStat(steal);
    addPendingStat(shot);

    expect(await replayPendingStats()).toEqual({ saved: 2, dropped: 0, failed: 0 });
    expect(await getGameEvents(game.id)).toEqual([
      {
        id: 'b',
        gameId: game.id,
        type: 'fg3_miss',
        period: 3,
        createdAt: T0,
        location: { x: 22, y: 1 },
      },
      { id: 'a', gameId: game.id, type: 'stl', period: 2, createdAt: T0 + 10 },
    ]);
    expect(journalKeys()).toEqual([]);
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
  });

  it('saves a tap whose write landed after all only once', async () => {
    const game = await newGame();
    const steal = stat({ gameId: game.id });
    addPendingStat(steal);
    // Its write landed, but the page that made it heard it failed, and kept it.
    await savePendingStat(steal);

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect((await getGameEvents(game.id)).map((event) => event.id)).toEqual([steal.id]);
    expect(journalKeys()).toEqual([]);
  });

  it('gives a tap saved before its spot was marked that spot, once', async () => {
    const game = await newGame();
    const shot = stat({ gameId: game.id, type: 'fg2_made' });
    // Its write landed without a spot (the page heard it failed); the spot was marked
    // next, and kept with the tap.
    await savePendingStat(shot);
    const elbow = { x: -6, y: 13.75 };
    addPendingStat({ ...shot, location: elbow });

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect(await getGameEvents(game.id)).toEqual([
      { id: shot.id, gameId: game.id, type: 'fg2_made', period: 2, createdAt: T0, location: elbow },
    ]);
    expect(journalKeys()).toEqual([]);

    // A spot moved since wins; a tap without one never clears it.
    const layup = { x: 1, y: 2 };
    expect((await savePendingStat({ ...shot, location: layup })).location).toEqual(layup);
    expect((await savePendingStat(shot)).location).toEqual(layup);
    expect(await getGameEvents(game.id)).toHaveLength(1);
  });

  it('saves taps on a finished game too', async () => {
    const game = await newGame();
    await endGame(game.id, { teamScore: 40, opponentScore: 38 });
    addPendingStat(stat({ gameId: game.id, type: 'ft_made' }));
    expect(await replayPendingStats()).toMatchObject({ saved: 1 });
    expect((await getGameEvents(game.id)).map((event) => event.type)).toEqual(['ft_made']);
  });

  it('drops the taps of a game that no longer exists', async () => {
    const kept = await newGame();
    const deleted = await newGame({ opponent: 'Roosevelt' });
    await deleteGame(deleted.id);
    addPendingStat(stat({ id: 'a', gameId: deleted.id }));
    addPendingStat(stat({ id: 'b', gameId: 'never-was' }));
    addPendingStat(stat({ id: 'c', gameId: kept.id }));

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 2, failed: 0 });
    expect((await getAllEvents()).map((event) => event.id)).toEqual(['c']);
    expect(journalKeys()).toEqual([]);
  });

  it("keeps a tap it couldn't save, and saves it next time", async () => {
    const game = await newGame();
    addPendingStat(stat({ id: 'a', gameId: game.id, at: T0 }));
    addPendingStat(stat({ id: 'b', gameId: game.id, at: T0 + 1 }));
    vi.spyOn(repo, 'recordStat').mockRejectedValueOnce(
      new DOMException('Connection to Indexed Database server lost.', 'UnknownError'),
    );

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 1 });
    expect(journalKeys()).toEqual([`${KEY_PREFIX}a`]);
    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect((await getGameEvents(game.id)).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('keeps every tap when the database cannot be read', async () => {
    addPendingStat(stat({ id: 'a' }));
    addPendingStat(stat({ id: 'b' }));
    vi.spyOn(repo, 'getGame').mockRejectedValue(new Error('Database closed'));
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 2 });
    expect(journalKeys()).toEqual([`${KEY_PREFIX}a`, `${KEY_PREFIX}b`]);
  });

  it('leaves out a tap undone while it runs', async () => {
    const game = await newGame();
    addPendingStat(stat({ id: 'undone', gameId: game.id }));
    addPendingStat(stat({ id: 'kept', gameId: game.id, at: T0 + 1 }));
    // The Undo lands while the replay looks the game up.
    const { getGame } = repo;
    vi.spyOn(repo, 'getGame').mockImplementation((id) => {
      removePendingStat('undone');
      return getGame(id);
    });

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect((await getGameEvents(game.id)).map((event) => event.id)).toEqual(['kept']);
  });

  it('never rejects, even with no localStorage', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    await expect(replayPendingStats()).resolves.toEqual({ saved: 0, dropped: 0, failed: 0 });
  });
});
