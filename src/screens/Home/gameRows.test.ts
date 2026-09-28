import { describe, expect, it } from 'vitest';
import { emptyStatLine, type GameStatLine } from '@/data/stats';
import type { Game } from '@/data/types';
import { countOf, gameDateLabel, gameTitle, groupBySeason, resultBadge } from './gameRows';

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerId: 'p1',
    opponent: 'Central',
    date: '2026-09-27',
    periodFormat: 'quarters',
    currentPeriod: 4,
    status: 'final',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function entry(overrides: Partial<Game>): GameStatLine {
  return { game: game(overrides), line: emptyStatLine() };
}

describe('gameTitle', () => {
  it('reads "vs" for home, neutral and unknown venues, and "@" for away games', () => {
    expect(gameTitle(game({ homeAway: 'home' }))).toBe('vs Central');
    expect(gameTitle(game({ homeAway: 'neutral' }))).toBe('vs Central');
    expect(gameTitle(game())).toBe('vs Central');
    expect(gameTitle(game({ homeAway: 'away' }))).toBe('@ Central');
  });
});

describe('gameDateLabel', () => {
  it('leaves out the year for this year and shows it for other years', () => {
    expect(gameDateLabel('2026-09-27', '2026-12-01')).toBe('Sun, Sep 27');
    expect(gameDateLabel('2025-12-13', '2026-01-10')).toBe('Sat, Dec 13, 2025');
  });
});

describe('resultBadge', () => {
  it('shows a win, loss or tie with our score first', () => {
    expect(resultBadge(game({ teamScore: 45, opponentScore: 38 }))).toEqual({
      label: 'W 45–38',
      spoken: 'Won 45 to 38',
      tone: 'made',
    });
    expect(resultBadge(game({ teamScore: 38, opponentScore: 45 }))).toEqual({
      label: 'L 38–45',
      spoken: 'Lost 38 to 45',
      tone: 'miss',
    });
    expect(resultBadge(game({ teamScore: 40, opponentScore: 40 }))).toEqual({
      label: 'T 40–40',
      spoken: 'Tied 40 to 40',
      tone: 'neutral',
    });
  });

  it('marks a live game, even one with a score already', () => {
    expect(resultBadge(game({ status: 'live', teamScore: 10, opponentScore: 8 }))).toMatchObject({
      label: 'Live',
      tone: 'accent',
    });
  });

  it('shows Final for a finished game without both scores', () => {
    expect(resultBadge(game())).toMatchObject({ label: 'Final', tone: 'neutral' });
    expect(resultBadge(game({ teamScore: 50 }))).toMatchObject({ label: 'Final' });
  });
});

describe('groupBySeason', () => {
  it('keeps the order of each season’s newest game, and of the games within it', () => {
    const entries = [
      entry({ id: 'fall-2', season: 'Fall 2026' }),
      entry({ id: 'summer-2', season: 'Summer 2026' }),
      entry({ id: 'fall-1', season: 'Fall 2026' }),
      entry({ id: 'none' }),
      entry({ id: 'summer-1', season: 'Summer 2026' }),
    ];
    expect(
      groupBySeason(entries).map(({ season, entries: games }) => [
        season,
        games.map((e) => e.game.id),
      ]),
    ).toEqual([
      ['Fall 2026', ['fall-2', 'fall-1']],
      ['Summer 2026', ['summer-2', 'summer-1']],
      [undefined, ['none']],
    ]);
  });

  it('returns no groups for no games', () => {
    expect(groupBySeason([])).toEqual([]);
  });
});

describe('countOf', () => {
  it('uses the singular only for one', () => {
    expect(countOf(0, 'point')).toBe('0 points');
    expect(countOf(1, 'point')).toBe('1 point');
    expect(countOf(14, 'rebound')).toBe('14 rebounds');
  });
});
