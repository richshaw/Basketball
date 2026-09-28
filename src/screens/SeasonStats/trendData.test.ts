import { describe, expect, it } from 'vitest';
import { emptyStatLine, type GameStatLine } from '@/data/stats';
import type { Game } from '@/data/types';
import {
  describePoint,
  describeTrend,
  highestPoint,
  isTrendMetric,
  trendPoints,
  type TrendPoint,
} from './trendData';

function game(id: string, opponent: string, date: string, homeAway?: Game['homeAway']): Game {
  return {
    id,
    playerId: 'p',
    opponent,
    date,
    periodFormat: 'quarters',
    currentPeriod: 4,
    status: 'final',
    createdAt: 0,
    updatedAt: 0,
    ...(homeAway ? { homeAway } : {}),
  };
}

const entries: GameStatLine[] = [
  { game: game('a', 'Lincoln', '2026-08-01'), line: { ...emptyStatLine(), pts: 10, reb: 1 } },
  { game: game('b', 'Westview', '2026-08-22', 'away'), line: { ...emptyStatLine(), pts: 6 } },
  { game: game('c', 'Oak Ridge', '2026-09-12'), line: { ...emptyStatLine(), pts: 18, reb: 7 } },
  { game: game('d', 'Eastlake', '2026-09-24'), line: { ...emptyStatLine(), pts: 18, reb: 3 } },
];

describe('trendPoints', () => {
  it('takes one value per game, in the order given', () => {
    expect(trendPoints(entries, 'pts').map((point) => point.value)).toEqual([10, 6, 18, 18]);
    expect(trendPoints(entries, 'reb').map((point) => point.game.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('highestPoint', () => {
  it('gives ties to the earlier game, like season highs', () => {
    expect(highestPoint(trendPoints(entries, 'pts'))?.game.id).toBe('c');
    expect(highestPoint([])).toBeUndefined();
  });
});

describe('describePoint', () => {
  it('reads the date, the opponent and the value with its unit', () => {
    const [first, second] = trendPoints(entries, 'reb') as [TrendPoint, TrendPoint];
    expect(describePoint(first, 'reb')).toBe('Sat, Aug 1, vs Lincoln: 1 rebound');
    expect(describePoint(second, 'reb')).toBe('Sat, Aug 22, @ Westview: 0 rebounds');
  });

  it('adds the year when asked', () => {
    const [first] = trendPoints(entries, 'pts') as [TrendPoint];
    expect(describePoint(first, 'pts', { withYear: true })).toBe(
      'Sat, Aug 1, 2026, vs Lincoln: 10 points',
    );
  });
});

describe('describeTrend', () => {
  it('summarizes the range, the average, the high and the low', () => {
    const averages = { ...emptyStatLine(), pts: 13 };
    expect(describeTrend(trendPoints(entries, 'pts'), 'pts', averages)).toBe(
      // The game count keeps its no-break space (see formatGameCount).
      'Points in 4\u00a0games, Aug 1 – Sep 24. Average 13.0 a game. ' +
        'High 18 vs Oak Ridge on Sat, Sep 12. Low 6 @ Westview on Sat, Aug 22.',
    );
  });

  it('gives every date its year when asked', () => {
    const averages = { ...emptyStatLine(), pts: 13 };
    expect(describeTrend(trendPoints(entries, 'pts'), 'pts', averages, { withYear: true })).toBe(
      'Points in 4\u00a0games, Aug 1, 2026 – Sep 24, 2026. Average 13.0 a game. ' +
        'High 18 vs Oak Ridge on Sat, Sep 12, 2026. Low 6 @ Westview on Sat, Aug 22, 2026.',
    );
  });

  it('names no high or low when every game is the same', () => {
    const level = entries
      .slice(0, 3)
      .map((entry) => ({ ...entry, line: { ...entry.line, ast: 2 } }));
    expect(describeTrend(trendPoints(level, 'ast'), 'ast', { ...emptyStatLine(), ast: 2 })).toBe(
      'Assists in 3\u00a0games, Aug 1 – Sep 12. Average 2.0 a game.',
    );
  });

  it('keeps it short for a single game, or none', () => {
    const one = trendPoints(entries.slice(0, 1), 'ast');
    expect(describeTrend(one, 'ast', emptyStatLine())).toBe(
      'Assists in 1\u00a0game, Aug 1. Average 0.0 a game.',
    );
    expect(describeTrend([], 'reb', emptyStatLine())).toBe('Rebounds: no games yet.');
  });
});

describe('isTrendMetric', () => {
  it('accepts only the charted stats', () => {
    expect(isTrendMetric('pts')).toBe(true);
    expect(isTrendMetric('ast')).toBe(true);
    expect(isTrendMetric('stl')).toBe(false);
    expect(isTrendMetric(undefined)).toBe(false);
  });
});
