import { describe, expect, it } from 'vitest';
import {
  formatDateRange,
  formatGameCount,
  formatRecord,
  formatResult,
  formatScore,
  spansYears,
} from './gameLabels';

describe('spansYears', () => {
  it('is true once the games fall in more than one calendar year', () => {
    expect(spansYears([{ date: '2026-09-24' }, { date: '2026-01-02' }])).toBe(false);
    expect(spansYears([{ date: '2026-01-02' }, { date: '2025-12-30' }])).toBe(true);
    expect(
      spansYears([{ date: '2026-09-24' }, { date: '2026-08-01' }, { date: '2023-09-04' }]),
    ).toBe(true);
  });

  it('is false for one game or none', () => {
    expect(spansYears([{ date: '2026-09-24' }])).toBe(false);
    expect(spansYears([])).toBe(false);
  });
});

describe('formatDateRange', () => {
  it('joins the first and last day, without weekdays', () => {
    expect(formatDateRange('2026-08-01', '2026-09-24')).toBe('Aug 1 – Sep 24');
  });

  it('adds the years when asked', () => {
    expect(formatDateRange('2025-12-12', '2026-02-03', { withYear: true })).toBe(
      'Dec 12, 2025 – Feb 3, 2026',
    );
  });

  it('shows one date for a single day', () => {
    expect(formatDateRange('2026-09-24', '2026-09-24')).toBe('Sep 24');
    expect(formatDateRange('2026-09-24', '2026-09-24', { withYear: true })).toBe('Sep 24, 2026');
  });
});

describe('formatScore and formatResult', () => {
  const final = { status: 'final' as const, teamScore: 45, opponentScore: 38 };

  it('put our score first', () => {
    expect(formatScore(final)).toBe('45–38');
    expect(formatResult(final)).toBe('W 45–38');
    expect(formatResult({ ...final, teamScore: 30 })).toBe('L 30–38');
    expect(formatResult({ ...final, teamScore: 38 })).toBe('T 38–38');
  });

  it('are null without a final score', () => {
    expect(formatScore({ teamScore: 45 })).toBeNull();
    expect(formatResult({ status: 'final' })).toBeNull();
    expect(formatResult({ ...final, status: 'live' })).toBeNull();
  });
});

describe('formatRecord', () => {
  it('shows wins and losses, and ties only when there are some', () => {
    expect(formatRecord({ wins: 7, losses: 3, ties: 0 })).toBe('7–3');
    expect(formatRecord({ wins: 7, losses: 3, ties: 1 })).toBe('7–3–1');
    expect(formatRecord({ wins: 0, losses: 2, ties: 0 })).toBe('0–2');
  });

  it('is null when no game has a result', () => {
    expect(formatRecord({ wins: 0, losses: 0, ties: 0 })).toBeNull();
  });
});

describe('formatGameCount', () => {
  it('counts games, keeping the number and the word on one line', () => {
    // Joined by a no-break space (U+00A0).
    expect(formatGameCount(0)).toBe('0\u00a0games');
    expect(formatGameCount(1)).toBe('1\u00a0game');
    expect(formatGameCount(10)).toBe('10\u00a0games');
  });
});
