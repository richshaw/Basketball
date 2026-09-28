import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  useAllEvents,
  useGame,
  useGameEvents,
  useGames,
  useLiveGame,
  usePlayer,
  useSeasons,
  useSettings,
} from './hooks';
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
