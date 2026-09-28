import { describe, expect, it } from 'vitest';
import type { StatType } from '@/data/types';
import {
  countByType,
  formatClockTime,
  foulStatus,
  matchupTitle,
  parseScore,
  periodChoices,
  statLabel,
  widestWordEm,
} from './tracking';

describe('countByType', () => {
  it('counts each stat type, with every type present', () => {
    const counts = countByType([{ type: 'fg2_made' }, { type: 'foul' }, { type: 'fg2_made' }]);
    expect(counts.fg2_made).toBe(2);
    expect(counts.foul).toBe(1);
    expect(counts.charge).toBe(0);
    expect(Object.keys(counts)).toHaveLength(15);
  });

  it('skips types it does not know', () => {
    const counts = countByType([{ type: 'dunk' as StatType }, { type: 'toString' as StatType }]);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
});

describe('statLabel', () => {
  it('uses the stat definitions, or the raw type for an unknown one', () => {
    expect(statLabel('fg3_made')).toBe('3PT Made');
    expect(statLabel('charge')).toBe('Charge Taken');
    expect(statLabel('dunk' as StatType)).toBe('dunk');
  });
});

describe('matchupTitle', () => {
  it('uses "vs" at home or on a neutral court, and "@" away', () => {
    expect(matchupTitle({ opponent: 'Central', homeAway: 'home' })).toBe('vs Central');
    expect(matchupTitle({ opponent: 'Central', homeAway: 'neutral' })).toBe('vs Central');
    expect(matchupTitle({ opponent: 'Central' })).toBe('vs Central');
    expect(matchupTitle({ opponent: 'Central', homeAway: 'away' })).toBe('@ Central');
  });
});

describe('formatClockTime', () => {
  it('shows local 12-hour time with seconds and no AM/PM', () => {
    expect(formatClockTime(new Date(2026, 8, 27, 19, 4, 5).getTime())).toBe('7:04:05');
    expect(formatClockTime(new Date(2026, 8, 27, 0, 30, 0).getTime())).toBe('12:30:00');
    expect(formatClockTime(new Date(2026, 8, 27, 12, 0, 59).getTime())).toBe('12:00:59');
    expect(formatClockTime(new Date(2026, 8, 27, 9, 59, 9).getTime())).toBe('9:59:09');
  });
});

describe('periodChoices', () => {
  it('offers regulation plus four overtimes', () => {
    expect(periodChoices(1, 'quarters')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(periodChoices(2, 'halves')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('always offers the period after the current one, up to the maximum', () => {
    expect(periodChoices(8, 'quarters')).toHaveLength(9);
    expect(periodChoices(20, 'quarters')).toHaveLength(20);
  });
});

describe('foulStatus', () => {
  it('flags foul trouble at 4 and fouled out at 5 or more', () => {
    expect([0, 3, 4, 5, 6].map(foulStatus)).toEqual(['ok', 'ok', 'trouble', 'out', 'out']);
  });
});

describe('parseScore', () => {
  it('reads blank as "not given" and whole numbers up to 999 as scores', () => {
    expect(parseScore('')).toBeUndefined();
    expect(parseScore('  ')).toBeUndefined();
    expect(parseScore('0')).toBe(0);
    expect(parseScore(' 42 ')).toBe(42);
    expect(parseScore('999')).toBe(999);
  });

  it('rejects anything else', () => {
    for (const text of ['1000', '-3', '4.5', '4a', 'forty', '1e2']) {
      expect(parseScore(text), text).toBeNull();
    }
  });
});

describe('widestWordEm', () => {
  it('measures each word and returns the widest', () => {
    const measure = (word: string) => word.length / 2;
    expect(widestWordEm('Charge Taken', measure)).toBe(3);
    expect(widestWordEm('Deflection', measure)).toBe(5);
    expect(widestWordEm('  ', measure)).toBe(0);
  });
});
