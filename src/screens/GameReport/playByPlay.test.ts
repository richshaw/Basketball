import { describe, expect, it } from 'vitest';
import type { StatEvent, StatType } from '@/data/types';
import { countPlays, formatClockTime, periodName, periodSummary, playByPlay } from './playByPlay';

let nextId = 0;
function event(type: StatType, period: number, createdAt: number): StatEvent {
  nextId += 1;
  return { id: `e${nextId}`, gameId: 'g1', type, period, createdAt };
}

describe('playByPlay', () => {
  it('groups stats by period, with the points of each play and each period', () => {
    const events = [
      event('fg2_made', 1, 100),
      event('dreb', 1, 200),
      event('fg3_miss', 2, 300),
      event('ft_made', 2, 400),
      event('fg3_made', 2, 500),
    ];
    const groups = playByPlay(events, 'quarters');

    expect(
      groups.map(({ period, label, name, points, total }) => [period, label, name, points, total]),
    ).toEqual([
      [1, 'Q1', '1st quarter', 2, 2],
      [2, 'Q2', '2nd quarter', 4, 6],
    ]);
    expect(
      groups.map((group) =>
        group.plays.map((play) => [play.event.type, play.def.label, play.scored]),
      ),
    ).toEqual([
      [
        ['fg2_made', '2PT Made', 2],
        ['dreb', 'Def Reb', 0],
      ],
      [
        ['fg3_miss', '3PT Miss', 0],
        ['ft_made', 'FT Made', 1],
        ['fg3_made', '3PT Made', 3],
      ],
    ]);
    expect(countPlays(groups)).toBe(5);
  });

  it('orders by period, then by when each stat was recorded', () => {
    // A correction recorded after the game ended, in the 4th quarter, and an OT stat.
    const events = [
      event('ast', 1, 100),
      event('fg2_made', 5, 400),
      event('stl', 4, 300),
      event('fg2_made', 4, 900),
      event('blk', 1, 200),
    ];
    const groups = playByPlay(events, 'quarters');

    expect(groups.map((group) => group.label)).toEqual(['Q1', 'Q4', 'OT']);
    expect(groups.flatMap((group) => group.plays.map((play) => play.event.type))).toEqual([
      'ast',
      'blk',
      'stl',
      'fg2_made',
      'fg2_made',
    ]);
    expect(groups.map((group) => [group.points, group.total])).toEqual([
      [0, 0],
      [2, 2],
      [2, 4],
    ]);
  });

  it('skips periods without stats and has nothing for a game without any', () => {
    expect(playByPlay([event('foul', 2, 1)], 'halves').map((group) => group.name)).toEqual([
      '2nd half',
    ]);
    expect(playByPlay([], 'quarters')).toEqual([]);
  });

  it('leaves out stat types this version does not know, like the box score does', () => {
    const fromNewerApp = { ...event('fg2_made', 1, 50), type: 'tip_in' as StatType };
    const groups = playByPlay(
      [
        fromNewerApp,
        event('fg2_made', 1, 100),
        { ...event('ast', 2, 200), type: 'toString' as StatType },
      ],
      'quarters',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.plays.map((play) => play.event.type)).toEqual(['fg2_made']);
    expect(groups[0]?.points).toBe(2);
  });
});

describe('periodSummary', () => {
  it('counts the plays and points, and adds her running total once it differs', () => {
    const groups = playByPlay(
      [
        event('fg2_made', 1, 1),
        event('fg2_made', 1, 2),
        event('ft_made', 1, 3),
        event('stl', 1, 4),
        event('ast', 2, 5),
        event('ft_made', 3, 6),
      ],
      'quarters',
    );
    expect(groups.map(periodSummary)).toEqual([
      '4 plays · 5 pts',
      '1 play · 0 pts · 5 total',
      '1 play · 1 pt · 6 total',
    ]);
  });
});

describe('periodName', () => {
  it('spells out quarters, halves and overtimes', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((period) => periodName(period, 'quarters'))).toEqual([
      '1st quarter',
      '2nd quarter',
      '3rd quarter',
      '4th quarter',
      'Overtime',
      '2nd overtime',
      '3rd overtime',
    ]);
    expect([1, 2, 3, 4].map((period) => periodName(period, 'halves'))).toEqual([
      '1st half',
      '2nd half',
      'Overtime',
      '2nd overtime',
    ]);
    expect(periodName(15, 'quarters')).toBe('11th overtime');
    expect(periodName(16, 'halves')).toBe('14th overtime');
  });
});

describe('formatClockTime', () => {
  it('shows local time on a 12-hour clock without AM/PM', () => {
    expect(formatClockTime(new Date(2026, 8, 27, 18, 5).getTime())).toBe('6:05');
    expect(formatClockTime(new Date(2026, 8, 27, 9, 41).getTime())).toBe('9:41');
    expect(formatClockTime(new Date(2026, 8, 27, 0, 30).getTime())).toBe('12:30');
    expect(formatClockTime(new Date(2026, 8, 27, 12, 0).getTime())).toBe('12:00');
    expect(formatClockTime(new Date(2026, 8, 27, 23, 59).getTime())).toBe('11:59');
  });
});
