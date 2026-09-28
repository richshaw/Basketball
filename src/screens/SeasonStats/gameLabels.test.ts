import { describe, expect, it } from 'vitest';
import {
  formatDateRange,
  formatGameCount,
  formatRecord,
  formatResult,
  formatScore,
  formatShortDate,
  opponentLabel,
} from './gameLabels';

describe('formatShortDate', () => {
  it('shows the month and day of a local date', () => {
    expect(formatShortDate('2026-09-12')).toBe('Sep 12');
    expect(formatShortDate('2026-01-01', { withYear: true })).toBe('Jan 1, 2026');
  });

  it('returns anything that is not a date unchanged', () => {
    expect(formatShortDate('someday')).toBe('someday');
  });
});

describe('formatDateRange', () => {
  it('joins two dates in the same year', () => {
    expect(formatDateRange('2026-08-01', '2026-09-24')).toBe('Aug 1 – Sep 24');
  });

  it('adds the years when the range crosses New Year', () => {
    expect(formatDateRange('2025-12-12', '2026-02-03')).toBe('Dec 12, 2025 – Feb 3, 2026');
  });

  it('shows one date for a single day', () => {
    expect(formatDateRange('2026-09-24', '2026-09-24')).toBe('Sep 24');
  });
});

describe('opponentLabel', () => {
  it('says "at" for away games and "vs" otherwise', () => {
    expect(opponentLabel({ opponent: 'Lincoln', homeAway: 'away' })).toBe('at Lincoln');
    expect(opponentLabel({ opponent: 'Lincoln', homeAway: 'home' })).toBe('vs Lincoln');
    expect(opponentLabel({ opponent: 'Lincoln', homeAway: 'neutral' })).toBe('vs Lincoln');
    expect(opponentLabel({ opponent: 'Lincoln' })).toBe('vs Lincoln');
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
  it('counts games', () => {
    expect(formatGameCount(0)).toBe('0 games');
    expect(formatGameCount(1)).toBe('1 game');
    expect(formatGameCount(10)).toBe('10 games');
  });
});
