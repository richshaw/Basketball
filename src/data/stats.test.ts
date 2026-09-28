import { describe, expect, it } from 'vitest';
import {
  addStatLines,
  computeStatLine,
  emptyStatLine,
  FIELD_GOAL_TYPES,
  gameResult,
  groupEventsByGame,
  isFieldGoalType,
  percentage,
  periodLabel,
  regulationPeriods,
  STAT_DEFS,
  STAT_LINE_KEYS,
  statLinesByPeriod,
  statLinesForGames,
  summarizeGames,
  type StatLine,
} from './stats';
import { STAT_TYPES, type Game, type StatEvent, type StatType } from './types';

let nextEventId = 1;

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerId: 'p1',
    opponent: 'Lincoln',
    date: '2026-09-01',
    periodFormat: 'quarters',
    currentPeriod: 4,
    status: 'final',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function event(type: StatType, period = 1, gameId = 'g1'): StatEvent {
  const id = nextEventId++;
  return { id: `e${id}`, gameId, type, period, createdAt: id };
}

function events(...types: StatType[]): StatEvent[] {
  return types.map((type) => event(type));
}

function line(overrides: Partial<StatLine>): StatLine {
  return { ...emptyStatLine(), ...overrides };
}

describe('STAT_DEFS', () => {
  it('defines every stat type', () => {
    expect(Object.keys(STAT_DEFS).sort()).toEqual([...STAT_TYPES].sort());
  });

  it('scores made shots only', () => {
    const points = Object.fromEntries(STAT_TYPES.map((type) => [type, STAT_DEFS[type].points]));
    expect(points).toMatchObject({ fg2_made: 2, fg3_made: 3, ft_made: 1 });
    const scoring = STAT_TYPES.filter((type) => STAT_DEFS[type].points > 0);
    expect(scoring).toEqual(['fg2_made', 'fg3_made', 'ft_made']);
    expect(scoring.every((type) => STAT_DEFS[type].kind === 'made')).toBe(true);
  });

  it('marks shot attempts made or missed and everything else as other', () => {
    for (const type of STAT_TYPES) {
      const def = STAT_DEFS[type];
      if (def.shot) expect(def.kind, type).toBe(type.endsWith('_made') ? 'made' : 'miss');
      else expect(def.kind, type).toBe('other');
    }
    expect(STAT_DEFS.charge.label).toBe('Charge Taken');
    expect(STAT_DEFS.oreb.label).toBe('Off Reb');
  });

  it('has unique labels and short labels', () => {
    const defs = Object.values(STAT_DEFS);
    expect(new Set(defs.map((def) => def.label)).size).toBe(defs.length);
    expect(new Set(defs.map((def) => def.shortLabel)).size).toBe(defs.length);
  });

  it('only lets 2PT and 3PT shots carry a location', () => {
    expect(STAT_TYPES.filter(isFieldGoalType)).toEqual([...FIELD_GOAL_TYPES]);
  });
});

describe('computeStatLine', () => {
  it('is all zeros with no events', () => {
    expect(computeStatLine([])).toEqual(emptyStatLine());
    expect(STAT_LINE_KEYS).toEqual(Object.keys(emptyStatLine()));
  });

  it('counts points and shooting', () => {
    const result = computeStatLine(
      events(
        'fg2_made',
        'fg2_made',
        'fg2_miss',
        'fg3_made',
        'fg3_miss',
        'fg3_miss',
        'ft_made',
        'ft_miss',
      ),
    );
    expect(result).toEqual(
      line({
        pts: 2 + 2 + 3 + 1,
        fgm: 3,
        fga: 6,
        fg2m: 2,
        fg2a: 3,
        fg3m: 1,
        fg3a: 3,
        ftm: 1,
        fta: 2,
      }),
    );
  });

  it('counts free throws apart from field goals', () => {
    const result = computeStatLine(events('ft_made', 'ft_made', 'ft_miss'));
    expect(result).toMatchObject({ pts: 2, ftm: 2, fta: 3, fgm: 0, fga: 0 });
  });

  it('counts rebounds, fouls and hustle stats', () => {
    const result = computeStatLine(
      events(
        'oreb',
        'dreb',
        'dreb',
        'ast',
        'stl',
        'blk',
        'tov',
        'foul',
        'foul',
        'deflection',
        'charge',
      ),
    );
    expect(result).toEqual(
      line({
        oreb: 1,
        dreb: 2,
        reb: 3,
        ast: 1,
        stl: 1,
        blk: 1,
        tov: 1,
        pf: 2,
        deflections: 1,
        charges: 1,
      }),
    );
  });

  it('ignores unknown stat types (e.g. from a newer version)', () => {
    const result = computeStatLine([{ type: 'fg2_made' }, { type: 'dunk' as StatType }]);
    expect(result).toMatchObject({ pts: 2, fgm: 1, fga: 1 });
  });
});

describe('addStatLines', () => {
  it('adds every field without changing the inputs', () => {
    const a = computeStatLine(events('fg2_made', 'oreb', 'ft_miss'));
    const b = computeStatLine(events('fg3_made', 'dreb', 'charge'));
    const aBefore = { ...a };
    expect(addStatLines(a, b)).toEqual(
      computeStatLine(events('fg2_made', 'oreb', 'ft_miss', 'fg3_made', 'dreb', 'charge')),
    );
    expect(a).toEqual(aBefore);
  });
});

describe('percentage', () => {
  it('is 0-100', () => {
    expect(percentage(5, 9)).toBeCloseTo(55.556, 3);
    expect(percentage(3, 3)).toBe(100);
    expect(percentage(0, 4)).toBe(0);
  });

  it('is null with no attempts', () => {
    expect(percentage(0, 0)).toBeNull();
  });
});

describe('periods', () => {
  it('has 4 quarters or 2 halves in regulation', () => {
    expect(regulationPeriods('quarters')).toBe(4);
    expect(regulationPeriods('halves')).toBe(2);
  });

  it('labels quarters then overtimes', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((p) => periodLabel(p, 'quarters'))).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'OT',
      '2OT',
      '3OT',
    ]);
  });

  it('labels halves then overtimes', () => {
    expect([1, 2, 3, 4, 5].map((p) => periodLabel(p, 'halves'))).toEqual([
      'H1',
      'H2',
      'OT',
      '2OT',
      '3OT',
    ]);
  });
});

describe('statLinesByPeriod', () => {
  it('lists every period up to the current one, including empty ones', () => {
    const result = statLinesByPeriod([event('fg2_made', 1), event('fg3_made', 3)], {
      currentPeriod: 4,
      periodFormat: 'quarters',
    });
    expect(result.map((p) => [p.period, p.label, p.line.pts])).toEqual([
      [1, 'Q1', 2],
      [2, 'Q2', 0],
      [3, 'Q3', 3],
      [4, 'Q4', 0],
    ]);
  });

  it('extends past the current period to the last period with an event', () => {
    const result = statLinesByPeriod([event('ft_made', 4), event('stl', 2)], {
      currentPeriod: 2,
      periodFormat: 'halves',
    });
    expect(result.map((p) => p.label)).toEqual(['H1', 'H2', 'OT', '2OT']);
    expect(result.map((p) => p.line.pts)).toEqual([0, 0, 0, 1]);
    expect(result[1]?.line.stl).toBe(1);
  });

  it('includes overtime for quarters', () => {
    const result = statLinesByPeriod([event('fg2_made', 5)], {
      currentPeriod: 6,
      periodFormat: 'quarters',
    });
    expect(result.map((p) => p.label)).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT']);
    expect(result[4]?.line.pts).toBe(2);
  });

  it('adds up to the game total', () => {
    const all = [
      event('fg2_made', 1),
      event('fg3_miss', 2),
      event('ft_made', 2),
      event('dreb', 4),
      event('fg2_made', 5),
    ];
    const periods = statLinesByPeriod(all, { currentPeriod: 5, periodFormat: 'quarters' });
    const total = periods.reduce((sum, p) => addStatLines(sum, p.line), emptyStatLine());
    expect(total).toEqual(computeStatLine(all));
  });

  it('shows period 1 for a brand-new game', () => {
    const result = statLinesByPeriod([], { currentPeriod: 1, periodFormat: 'quarters' });
    expect(result).toEqual([{ period: 1, label: 'Q1', line: emptyStatLine() }]);
  });
});

describe('gameResult', () => {
  it('is W, L or T for a final game with both scores', () => {
    expect(gameResult(game({ teamScore: 50, opponentScore: 40 }))).toBe('W');
    expect(gameResult(game({ teamScore: 38, opponentScore: 41 }))).toBe('L');
    expect(gameResult(game({ teamScore: 44, opponentScore: 44 }))).toBe('T');
    expect(gameResult(game({ teamScore: 0, opponentScore: 2 }))).toBe('L');
  });

  it('is null for a live game or a missing score', () => {
    expect(gameResult(game({ status: 'live', teamScore: 50, opponentScore: 40 }))).toBeNull();
    expect(gameResult(game({ teamScore: 50 }))).toBeNull();
    expect(gameResult(game({ opponentScore: 40 }))).toBeNull();
    expect(gameResult(game())).toBeNull();
  });
});

describe('groupEventsByGame and statLinesForGames', () => {
  it('pairs each game with its own events', () => {
    const g1 = game({ id: 'g1' });
    const g2 = game({ id: 'g2' });
    const g3 = game({ id: 'g3' });
    const all = [
      event('fg2_made', 1, 'g1'),
      event('fg3_made', 1, 'g2'),
      event('ft_made', 2, 'g1'),
      event('ast', 1, 'other'),
    ];
    const grouped = groupEventsByGame(all);
    expect(grouped.get('g1')?.map((e) => e.type)).toEqual(['fg2_made', 'ft_made']);

    const lines = statLinesForGames([g1, g2, g3], all);
    expect(lines.map(({ game: g, line: l }) => [g.id, l.pts])).toEqual([
      ['g1', 3],
      ['g2', 3],
      ['g3', 0],
    ]);
  });
});

describe('summarizeGames', () => {
  it('handles no games', () => {
    const summary = summarizeGames([]);
    expect(summary).toEqual({
      gamesPlayed: 0,
      record: { wins: 0, losses: 0, ties: 0 },
      totals: emptyStatLine(),
      averages: emptyStatLine(),
      shooting: { fgPct: null, fg2Pct: null, fg3Pct: null, ftPct: null },
      highs: { pts: null, reb: null, ast: null, stl: null, blk: null, deflections: null },
    });
  });

  it('counts the record from final games with both scores', () => {
    const summary = summarizeGames([
      { game: game({ id: 'a', teamScore: 50, opponentScore: 40 }), line: emptyStatLine() },
      { game: game({ id: 'b', teamScore: 30, opponentScore: 40 }), line: emptyStatLine() },
      { game: game({ id: 'c', teamScore: 45, opponentScore: 40 }), line: emptyStatLine() },
      { game: game({ id: 'd', teamScore: 40, opponentScore: 40 }), line: emptyStatLine() },
      { game: game({ id: 'e' }), line: emptyStatLine() },
      {
        game: game({ id: 'f', status: 'live', teamScore: 9, opponentScore: 2 }),
        line: emptyStatLine(),
      },
    ]);
    expect(summary.gamesPlayed).toBe(6);
    expect(summary.record).toEqual({ wins: 2, losses: 1, ties: 1 });
  });

  it('totals and averages every field', () => {
    const summary = summarizeGames([
      { game: game({ id: 'a' }), line: line({ pts: 10, fgm: 4, fga: 9, ast: 3, reb: 5 }) },
      { game: game({ id: 'b' }), line: line({ pts: 15, fgm: 6, fga: 10, ast: 0, reb: 2 }) },
    ]);
    expect(summary.totals).toMatchObject({ pts: 25, fgm: 10, fga: 19, ast: 3, reb: 7 });
    expect(summary.averages).toMatchObject({ pts: 12.5, fgm: 5, fga: 9.5, ast: 1.5, reb: 3.5 });
    expect(Object.keys(summary.averages)).toEqual([...STAT_LINE_KEYS]);
  });

  it('computes shooting from totals, not an average of percentages', () => {
    const summary = summarizeGames([
      { game: game({ id: 'a' }), line: line({ fgm: 1, fga: 1, fg2m: 1, fg2a: 1 }) },
      { game: game({ id: 'b' }), line: line({ fgm: 1, fga: 9, fg2m: 1, fg2a: 9, fta: 2 }) },
    ]);
    expect(summary.shooting.fgPct).toBeCloseTo(20);
    expect(summary.shooting.fg2Pct).toBeCloseTo(20);
    expect(summary.shooting.fg3Pct).toBeNull();
    expect(summary.shooting.ftPct).toBe(0);
  });

  it('finds game highs, giving ties to the earliest game', () => {
    const summary = summarizeGames([
      {
        game: game({ id: 'late', date: '2026-10-05' }),
        line: line({ pts: 18, reb: 4, ast: 2, stl: 1 }),
      },
      {
        game: game({ id: 'early', date: '2026-09-05' }),
        line: line({ pts: 18, reb: 7, ast: 1, deflections: 3 }),
      },
      {
        game: game({ id: 'middle', date: '2026-09-20' }),
        line: line({ pts: 9, reb: 7, ast: 5 }),
      },
    ]);
    expect(summary.highs).toEqual({
      pts: { value: 18, gameId: 'early' },
      reb: { value: 7, gameId: 'early' },
      ast: { value: 5, gameId: 'middle' },
      stl: { value: 1, gameId: 'late' },
      blk: null,
      deflections: { value: 3, gameId: 'early' },
    });
  });

  it('breaks same-day ties by creation time', () => {
    const summary = summarizeGames([
      { game: game({ id: 'second', createdAt: 2000 }), line: line({ pts: 8 }) },
      { game: game({ id: 'first', createdAt: 1000 }), line: line({ pts: 8 }) },
    ]);
    expect(summary.highs.pts).toEqual({ value: 8, gameId: 'first' });
  });
});
