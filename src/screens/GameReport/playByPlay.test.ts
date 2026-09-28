import { describe, expect, it } from 'vitest';
import type { StatEvent, StatType } from '@/data/types';
import { formatClockTime, periodName, playByPlay } from './playByPlay';

let nextId = 0;
function event(type: StatType, period: number, createdAt: number): StatEvent {
  nextId += 1;
  return { id: `e${nextId}`, gameId: 'g1', type, period, createdAt };
}

describe('playByPlay', () => {
  it('groups stats by period with her running points', () => {
    const events = [
      event('fg2_made', 1, 100),
      event('dreb', 1, 200),
      event('fg3_miss', 2, 300),
      event('ft_made', 2, 400),
      event('fg3_made', 2, 500),
    ];
    const groups = playByPlay(events, 'quarters');

    expect(groups.map(({ period, label, name }) => ({ period, label, name }))).toEqual([
      { period: 1, label: 'Q1', name: '1st quarter' },
      { period: 2, label: 'Q2', name: '2nd quarter' },
    ]);
    expect(
      groups.map((group) => group.plays.map((play) => [play.event.type, play.scored, play.points])),
    ).toEqual([
      [
        ['fg2_made', 2, 2],
        ['dreb', 0, 2],
      ],
      [
        ['fg3_miss', 0, 2],
        ['ft_made', 1, 3],
        ['fg3_made', 3, 6],
      ],
    ]);
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
    expect(groups.at(-1)?.plays.at(-1)?.points).toBe(4);
  });

  it('skips periods without stats and has nothing for a game without any', () => {
    expect(playByPlay([event('foul', 2, 1)], 'halves').map((group) => group.name)).toEqual([
      '2nd half',
    ]);
    expect(playByPlay([], 'quarters')).toEqual([]);
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
