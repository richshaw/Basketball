import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  replayPendingStats,
  retryPendingStats,
  savePendingStat,
  savePendingStatsBeforeExport,
  startPendingStatsRetry,
} from './pendingSaves';
import { addPendingSpot, listPendingSpots } from './pendingSpots';
import {
  addPendingStat,
  holdUnsavedTaps,
  notifyPendingStats,
  removePendingStat,
  type PendingStat,
  type UnsavedTapHolder,
} from './pendingStats';
import * as repo from './repo';
import {
  createGame,
  deleteGame,
  endGame,
  getAllEvents,
  getGameEvents,
  recordStat,
  type NewGame,
} from './repo';
import type { Game, StatEvent } from './types';

const T0 = new Date(2026, 8, 27, 18, 0).getTime();
const KEY_PREFIX = 'hoop-stats.pendingStat.';

/** Undone after each test: retries started, holders registered. */
const cleanups: (() => void)[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (let cleanup = cleanups.pop(); cleanup; cleanup = cleanups.pop()) cleanup();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function eventTypes(gameId: string) {
  return (await getGameEvents(gameId)).map((event) => event.type);
}

/** Starts the app-wide retry for this test only. */
function startRetry(delaysMs: readonly number[]) {
  cleanups.push(startPendingStatsRetry({ delaysMs }));
}

/** Taps held in memory by a (fake) tracking session, for this test only. */
function holdTaps(
  holder: Pick<UnsavedTapHolder, 'gameId' | 'hasUnsaved' | 'retryQuietly'> &
    Partial<UnsavedTapHolder>,
) {
  cleanups.push(
    holdUnsavedTaps({ reloadSafe: () => true, saved: () => {}, forget: () => () => {}, ...holder }),
  );
}

/** Makes every save fail, as when WebKit has lost its IndexedDB connection. */
function failSaves() {
  return vi
    .spyOn(repo, 'recordStat')
    .mockRejectedValue(
      new DOMException('Connection to Indexed Database server lost.', 'UnknownError'),
    );
}

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

  it('tells the sessions holding a tap that it saved it, and as what, once its entry is gone', async () => {
    const game = await newGame();
    addPendingStat(stat({ id: 'a', gameId: game.id }));
    const told: [string, string[], StatEvent][] = [];
    holdTaps({
      gameId: game.id,
      hasUnsaved: () => true,
      retryQuietly: () => Promise.resolve(),
      saved: (id, event) => told.push([id, journalKeys(), event]),
    });
    expect(await replayPendingStats()).toMatchObject({ saved: 1 });
    expect(told).toEqual([
      ['a', [], { id: 'a', gameId: game.id, type: 'stl', period: 2, createdAt: T0 }],
    ]);
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

  it("leaves a tap for next time when it can't tell whether it's still kept", async () => {
    const game = await newGame();
    addPendingStat(stat({ gameId: game.id }));
    // localStorage lists the taps, then can't be read for a moment.
    const { getGame } = repo;
    vi.spyOn(repo, 'getGame').mockImplementation((id) => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
      return getGame(id);
    });

    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
    expect(await eventTypes(game.id)).toEqual([]);
    vi.restoreAllMocks();
    expect(journalKeys()).toEqual([`${KEY_PREFIX}tap-1`]);
    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect(await eventTypes(game.id)).toEqual(['stl']);
  });

  it('never rejects, even with no localStorage', async () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    await expect(replayPendingStats()).resolves.toEqual({ saved: 0, dropped: 0, failed: 0 });
  });
});

describe('retryPendingStats', () => {
  it('saves the kept taps, then tries the taps held in memory again, quietly', async () => {
    const game = await newGame();
    addPendingStat(stat({ gameId: game.id }));
    const order: string[] = [];
    const { recordStat: save } = repo;
    vi.spyOn(repo, 'recordStat').mockImplementation((...args) => {
      order.push('kept tap');
      return save(...args);
    });
    holdTaps({
      gameId: 'held',
      hasUnsaved: () => true,
      retryQuietly: () => {
        order.push('held taps');
        return Promise.resolve();
      },
    });

    await retryPendingStats();
    expect(order).toEqual(['kept tap', 'held taps']);
    expect(await eventTypes(game.id)).toEqual(['stl']);
  });

  it('never rejects', async () => {
    holdTaps({
      gameId: 'held',
      hasUnsaved: () => true,
      retryQuietly: () => Promise.reject(new Error('Disk error')),
    });
    await expect(retryPendingStats()).resolves.toBeUndefined();
  });
});

describe('savePendingStatsBeforeExport', () => {
  it('saves the taps not saved yet', async () => {
    const game = await newGame();
    addPendingStat(stat({ gameId: game.id }));
    await savePendingStatsBeforeExport();
    expect(await eventTypes(game.id)).toEqual(['stl']);
  });

  it("doesn't wait long for a save that never answers", async () => {
    const game = await newGame();
    addPendingStat(stat({ gameId: game.id }));
    vi.spyOn(repo, 'recordStat').mockReturnValue(new Promise(() => {}));
    const started = performance.now();
    await savePendingStatsBeforeExport(50);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(journalKeys()).toHaveLength(1);
  });
});

describe('startPendingStatsRetry (the app-wide retry)', () => {
  it('saves the taps an earlier page kept, at once', async () => {
    const game = await newGame();
    addPendingStat(stat({ gameId: game.id }));
    startRetry([60_000]);
    await vi.waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
    expect(journalKeys()).toEqual([]);
  });

  it('keeps trying on a timer that backs off while a tap is not saved, and stops once it is', async () => {
    const game = await newGame();
    addPendingStat(stat({ gameId: game.id }));
    const failing = failSaves();
    const tries: number[] = [];
    failing.mockImplementation(() => {
      tries.push(performance.now());
      return Promise.reject(new DOMException('Connection lost.', 'UnknownError'));
    });
    startRetry([40, 300]);

    // At once, then 40 ms later, then every 300 ms.
    await vi.waitFor(() => expect(tries).toHaveLength(4), { timeout: 3000 });
    const gaps = tries.slice(1).map((time, index) => time - (tries[index] ?? 0));
    expect(gaps[0]).toBeGreaterThanOrEqual(35);
    expect(gaps[0]).toBeLessThan(250);
    expect(gaps[1]).toBeGreaterThanOrEqual(290);
    expect(gaps[2]).toBeGreaterThanOrEqual(290);

    // The database works again: saved by the next try, and then nothing more is tried.
    failing.mockRestore();
    await vi.waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']), {
      timeout: 2000,
    });
    const saves = vi.spyOn(repo, 'recordStat');
    await sleep(300);
    expect(saves).not.toHaveBeenCalled();
    expect(journalKeys()).toEqual([]);
  });

  it('puts a kept spot on its stat too, with no live game screen open', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg3_made');
    const corner = { x: 23, y: -3 };
    // Kept by a page that couldn't put it on its stat before it closed.
    addPendingSpot({ id: shot.id, gameId: game.id, location: corner });
    vi.spyOn(repo, 'setStatLocation').mockRejectedValueOnce(
      new DOMException('Connection to Indexed Database server lost.', 'UnknownError'),
    );
    // The try at start fails; the next one, on the timer, puts it on.
    startRetry([40]);
    await vi.waitFor(async () =>
      expect((await getGameEvents(game.id)).map((event) => event.location)).toEqual([corner]),
    );
    expect(listPendingSpots()).toEqual([]);
  });

  it('tries again when the app is shown again, and when the connection comes back', async () => {
    const game = await newGame();
    // A long timer: only the app's own events can bring the tries below.
    startRetry([60_000]);
    addPendingStat(stat({ id: 'shown', gameId: game.id, at: T0 }));
    notifyPendingStats();

    expect(document.visibilityState).toBe('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));

    addPendingStat(stat({ id: 'online', gameId: game.id, type: 'blk', at: T0 + 1 }));
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl', 'blk']));
    expect(journalKeys()).toEqual([]);
  });

  it('tries the taps held in memory again, kept or not, once told a save failed', async () => {
    let unsaved = true;
    const retryQuietly = vi.fn(() => {
      unsaved = false;
      return Promise.resolve();
    });
    startRetry([30]);
    await sleep(10);
    holdTaps({ gameId: 'g', hasUnsaved: () => unsaved, retryQuietly });
    expect(retryQuietly).not.toHaveBeenCalled();

    // A tracking session's save failed (e.g. after the live game screen closed).
    notifyPendingStats();
    await vi.waitFor(() => expect(retryQuietly).toHaveBeenCalledTimes(1));
    // Nothing is pending any more: no more tries.
    await sleep(150);
    expect(retryQuietly).toHaveBeenCalledTimes(1);
  });

  it('carries on past a try that never answers', async () => {
    let tries = 0;
    holdTaps({
      gameId: 'g',
      hasUnsaved: () => true,
      // The first try hangs (a save that never answers); the next ones don't.
      retryQuietly: () => (++tries === 1 ? new Promise(() => {}) : Promise.resolve()),
    });
    cleanups.push(startPendingStatsRetry({ delaysMs: [30], tryWaitMs: 50 }));
    await vi.waitFor(() => expect(tries).toBeGreaterThanOrEqual(3));
  });

  it('does nothing while nothing is pending, and nothing once stopped', async () => {
    const replay = vi.spyOn(repo, 'getGame');
    const stop = startPendingStatsRetry({ delaysMs: [20] });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    notifyPendingStats();
    await sleep(100);
    expect(replay).not.toHaveBeenCalled();

    stop();
    const game = await newGame();
    addPendingStat(stat({ gameId: game.id }));
    notifyPendingStats();
    document.dispatchEvent(new Event('visibilitychange'));
    await sleep(100);
    expect(await eventTypes(game.id)).toEqual([]);
  });
});
