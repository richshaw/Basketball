import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import {
  READ_RETRY_DELAYS_MS,
  READ_WATCHDOG_MS,
  useAllEvents,
  useGame,
  useGameEvents,
  useGames,
  useLiveGame,
  usePlayer,
  useSeasons,
  useSettings,
  useSteadyGame,
  useSteadyGameEvents,
} from './hooks';
import { setReopenDelaysForTests } from './reopen';
import * as repo from './repo';
import {
  createGame,
  endGame,
  recordStat,
  savePlayer,
  undoLastStat,
  updateSettings,
  type NewGame,
} from './repo';
import type { Game } from './types';

function newGame(overrides: Partial<NewGame> = {}): Promise<Game> {
  return createGame({
    opponent: 'Lincoln',
    date: '2026-09-27',
    periodFormat: 'quarters',
    ...overrides,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('data hooks', () => {
  it('return undefined while loading, then the data', async () => {
    const { result } = renderHook(() => useGames());
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toEqual([]));
  });

  it('return null for a missing record', async () => {
    const player = renderHook(() => usePlayer());
    const game = renderHook(() => useGame('nope'));
    const noId = renderHook(() => useGame(undefined));
    const live = renderHook(() => useLiveGame());
    await waitFor(() => {
      expect(player.result.current).toBeNull();
      expect(game.result.current).toBeNull();
      expect(noId.result.current).toBeNull();
      expect(live.result.current).toBeNull();
    });
  });

  it('update when the data changes', async () => {
    const games = renderHook(() => useGames());
    const player = renderHook(() => usePlayer());
    await waitFor(() => expect(games.result.current).toEqual([]));

    const game = await act(() => newGame({ season: 'Fall 2026' }));
    await waitFor(() => expect(games.result.current).toEqual([game]));

    await act(() => savePlayer({ name: 'Ava' }));
    await waitFor(() => expect(player.result.current?.name).toBe('Ava'));
  });

  it("follow a game's events as stats are recorded and undone", async () => {
    const game = await newGame();
    const { result } = renderHook(() => useGameEvents(game.id));
    await waitFor(() => expect(result.current).toEqual([]));

    await act(() => recordStat(game.id, 'fg3_made'));
    await act(() => recordStat(game.id, 'ast'));
    await waitFor(() => expect(result.current?.map((e) => e.type)).toEqual(['fg3_made', 'ast']));

    await act(() => undoLastStat(game.id));
    await waitFor(() => expect(result.current?.map((e) => e.type)).toEqual(['fg3_made']));
  });

  it('never show one game under another id', async () => {
    const first = await newGame({ opponent: 'First' });
    const second = await newGame({ opponent: 'Second' });
    await recordStat(first.id, 'stl');

    const { result, rerender } = renderHook(({ id }) => [useGame(id), useGameEvents(id)] as const, {
      initialProps: { id: first.id },
    });
    await waitFor(() => expect(result.current[0]?.opponent).toBe('First'));

    rerender({ id: second.id });
    // Straight after switching: loading, not the first game's data.
    expect(result.current).toEqual([undefined, undefined]);
    await waitFor(() => expect(result.current[0]?.opponent).toBe('Second'));
    expect(result.current[1]).toEqual([]);
  });

  it('find the live game, seasons, settings and all events', async () => {
    const game = await newGame({ season: 'Fall 2026' });
    await recordStat(game.id, 'dreb');
    const live = renderHook(() => useLiveGame());
    const seasons = renderHook(() => useSeasons());
    const settings = renderHook(() => useSettings());
    const events = renderHook(() => useAllEvents());

    await waitFor(() => {
      expect(live.result.current?.id).toBe(game.id);
      expect(seasons.result.current).toEqual(['Fall 2026']);
      expect(settings.result.current).toEqual({
        shotChart: true,
        defaultPeriodFormat: 'quarters',
        lastSeason: 'Fall 2026',
      });
      expect(events.result.current?.map((e) => e.type)).toEqual(['dreb']);
    });

    await act(() => endGame(game.id));
    await act(() => updateSettings({ shotChart: false }));
    await waitFor(() => {
      expect(live.result.current).toBeNull();
      expect(settings.result.current?.shotChart).toBe(false);
    });
  });
});

describe('steady reads (the live game screen)', () => {
  const lost = () =>
    new DOMException('Connection to Indexed Database server lost.', 'UnknownError');

  beforeEach(() => {
    // Each failed read is logged; that's expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('keep the last good result through a failed read, and read again when the app is shown', async () => {
    const game = await newGame();
    await recordStat(game.id, 'stl');
    const { result } = renderHook(() => useSteadyGameEvents(game.id));
    await waitFor(() => expect(result.current.value?.map((e) => e.type)).toEqual(['stl']));
    expect(result.current.failed).toBe(false);

    const reads = vi.spyOn(repo, 'getGameEvents').mockRejectedValue(lost());
    await act(() => recordStat(game.id, 'ast'));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.value?.map((e) => e.type)).toEqual(['stl']);
    expect(result.current.error).toBeInstanceOf(DOMException);
    expect(console.error).toHaveBeenCalledTimes(1);

    reads.mockRestore();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(result.current.value?.map((e) => e.type)).toEqual(['stl', 'ast']);
    expect(result.current.error).toBeUndefined();
  });

  it('read again on their own, sooner at first, and keep following changes after', async () => {
    const game = await newGame();
    const { result } = renderHook(() => useSteadyGame(game.id));
    await waitFor(() => expect(result.current.value?.id).toBe(game.id));

    const reads = vi.spyOn(repo, 'getGame').mockRejectedValue(lost());
    await act(() => recordStat(game.id, 'ast'));
    await waitFor(() => expect(result.current.failed).toBe(true));
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(2), {
      timeout: (READ_RETRY_DELAYS_MS[0] ?? 0) + 1000,
    });
    reads.mockRestore();
    await waitFor(() => expect(result.current.failed).toBe(false), {
      timeout: (READ_RETRY_DELAYS_MS[1] ?? 0) + 1000,
    });
    await act(() => endGame(game.id));
    await waitFor(() => expect(result.current.value?.status).toBe('final'));
  });

  it('read again when a read never answers (as Dexie does with an aborted one)', async () => {
    const game = await newGame();
    const { result } = renderHook(() => useSteadyGame(game.id));
    await waitFor(() => expect(result.current.value?.status).toBe('live'));

    // Reading the game again after it ends is aborted: Dexie gives neither a result nor
    // an error, so nothing says the game on screen is out of date.
    const reads = vi
      .spyOn(repo, 'getGame')
      .mockRejectedValueOnce(new DOMException('The transaction was aborted.', 'AbortError'));
    await act(() => endGame(game.id));
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
    expect(result.current).toMatchObject({ failed: false, value: { status: 'live' } });

    // It's read again a moment later.
    await waitFor(() => expect(result.current.value?.status).toBe('final'), {
      timeout: READ_WATCHDOG_MS + 2000,
    });
    expect(result.current.failed).toBe(false);
    expect(reads).toHaveBeenCalledTimes(2);
  });

  it('read again when the app comes back into view, failing or not, so a lost connection shows', async () => {
    const game = await newGame();
    const { result } = renderHook(() => useSteadyGame(game.id));
    await waitFor(() => expect(result.current.value?.id).toBe(game.id));

    // The connection was lost in the background. Nothing changed, so nothing read again.
    vi.spyOn(repo, 'getGame').mockRejectedValue(lost());
    await sleep(50);
    expect(result.current.failed).toBe(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.value?.id).toBe(game.id);
  });

  it('count a read that never answers as failed, once there is something on screen', async () => {
    const game = await newGame();
    const { result } = renderHook(() => useSteadyGame(game.id));
    await waitFor(() => expect(result.current.value?.id).toBe(game.id));

    // Reading hangs from now on: no result, and no error either.
    const reads = vi.spyOn(repo, 'getGame').mockReturnValue(new Promise(() => {}));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(result.current.failed).toBe(true), {
      timeout: READ_WATCHDOG_MS + 1000,
    });
    expect(result.current.error).toMatchObject({ name: 'TimeoutError' });
    expect(result.current.value?.id).toBe(game.id);

    reads.mockRestore();
    await waitFor(() => expect(result.current.failed).toBe(false), {
      timeout: (READ_RETRY_DELAYS_MS[0] ?? 0) + 2000,
    });
    expect(result.current.value?.id).toBe(game.id);
  }, 15_000);

  it('count a closed database as a failed read (liveQuery drops that one), until it is open again', async () => {
    // Dexie warns as it works around a failed open; that's expected here.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setReopenDelaysForTests([30]);
    const game = await newGame();
    await recordStat(game.id, 'stl');
    const { result } = renderHook(() => useSteadyGameEvents(game.id));
    await waitFor(() => expect(result.current.value?.map((e) => e.type)).toEqual(['stl']));

    // WebKit loses the connection: Dexie closes the database, and can't open it again.
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw lost();
    });
    db.close({ disableAutoOpen: false });
    // The next write (a tap, say) tries to, and fails: closed for good.
    await expect(recordStat(game.id, 'ast')).rejects.toThrow();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.error).toMatchObject({ name: 'DatabaseClosedError' });
    expect(result.current.value?.map((e) => e.type)).toEqual(['stl']);

    // The connection is back: the database opens again, and it's read again.
    open.mockRestore();
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(result.current.value?.map((e) => e.type)).toEqual(['stl']);
    await act(() => recordStat(game.id, 'ast'));
    await waitFor(() => expect(result.current.value?.map((e) => e.type)).toEqual(['stl', 'ast']));
  });

  it('say "loading" (and not the other game) after switching games, and "not found" as null', async () => {
    const first = await newGame({ opponent: 'First' });
    const { result, rerender } = renderHook(({ id }) => useSteadyGame(id), {
      initialProps: { id: first.id },
    });
    await waitFor(() => expect(result.current.value?.opponent).toBe('First'));
    rerender({ id: 'nope' });
    expect(result.current).toEqual({ value: undefined, failed: false, error: undefined });
    await waitFor(() => expect(result.current.value).toBeNull());
  });
});
