import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatAvg,
  formatGameDate,
  formatMadeAttempted,
  formatPct,
  formatPlayerName,
  isLocalISODate,
  pad2,
  parseLocalDate,
  todayLocalISO,
} from './format';

describe('local dates', () => {
  // West of UTC, `new Date('2026-09-27')` is the evening of Sep 26 locally: exactly
  // the bug these helpers avoid.
  beforeEach(() => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs these tests west of UTC', () => {
    expect(new Date('2026-09-27').getDate()).toBe(26);
  });

  it('formats a game date as the local calendar day', () => {
    expect(formatGameDate('2026-09-27')).toBe('Sun, Sep 27');
    expect(formatGameDate('2026-01-03')).toBe('Sat, Jan 3');
    expect(formatGameDate('2026-09-27', { withYear: true })).toBe('Sun, Sep 27, 2026');
  });

  it('parses to local midnight', () => {
    const date = parseLocalDate('2026-09-27');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(27);
    expect(date?.getHours()).toBe(0);
  });

  it("gives today's local date, even late in the evening", () => {
    // 11:30pm on Sep 27 in California is already Sep 28 in UTC.
    expect(todayLocalISO(new Date(2026, 8, 27, 23, 30))).toBe('2026-09-27');
    expect(todayLocalISO(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });

  it('rejects anything that is not a real YYYY-MM-DD date', () => {
    expect(isLocalISODate('2026-09-27')).toBe(true);
    expect(isLocalISODate('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-9-27', '27/09/2026', '', '0050-01-01']) {
      expect(isLocalISODate(bad), bad).toBe(false);
    }
    expect(formatGameDate('not a date')).toBe('not a date');
  });
});

describe('number formatting', () => {
  it('pads to two digits', () => {
    expect([0, 7, 10, 59, 123].map(pad2)).toEqual(['00', '07', '10', '59', '123']);
  });

  it('formats percentages', () => {
    expect(formatPct(45.4)).toBe('45%');
    expect(formatPct(55.56)).toBe('56%');
    expect(formatPct(0)).toBe('0%');
    expect(formatPct(100)).toBe('100%');
    expect(formatPct(null)).toBe('–');
  });

  it('formats averages with one decimal', () => {
    expect(formatAvg(12.345)).toBe('12.3');
    expect(formatAvg(12.5)).toBe('12.5');
    expect(formatAvg(0)).toBe('0.0');
    expect(formatAvg(7)).toBe('7.0');
    expect(formatAvg(Number.NaN)).toBe('–');
  });

  it('rounds a true .x5 up, even from a raw quotient', () => {
    // 17 / 20 is 0.85, stored as 0.8499…, which toFixed(1) alone shows as '0.8'.
    const cases = [
      [17, '0.9'],
      [19, '1.0'],
      [7, '0.4'],
      [3, '0.2'],
      [41, '2.1'],
      [29, '1.5'],
    ] as const;
    for (const [total, shown] of cases) expect(formatAvg(total / 20), `${total}/20`).toBe(shown);
  });

  it('formats makes and attempts', () => {
    expect(formatMadeAttempted(5, 9)).toBe('5/9');
    expect(formatMadeAttempted(0, 0)).toBe('0/0');
  });
});

describe('formatPlayerName', () => {
  it('falls back to "Player" before a name is set', () => {
    expect(formatPlayerName({ name: 'Ava' })).toBe('Ava');
    expect(formatPlayerName({ name: '  ' })).toBe('Player');
    expect(formatPlayerName(null)).toBe('Player');
    expect(formatPlayerName(undefined)).toBe('Player');
  });
});
