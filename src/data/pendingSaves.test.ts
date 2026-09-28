import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayPendingStats, savePendingStat } from './pendingSaves';
import { addPendingStat, removePendingStat, type PendingStat } from './pendingStats';
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
