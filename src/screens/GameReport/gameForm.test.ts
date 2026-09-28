import { describe, expect, it } from 'vitest';
import { MAX_SCORE, TEXT_LIMITS, type Game } from '@/data/types';
import { gameFormFrom, validateGameForm, type GameForm } from './gameForm';

const game: Game = {
  id: 'g1',
  playerId: 'p1',
  opponent: 'Central',
  date: '2026-09-27',
  season: 'Fall 2026',
  homeAway: 'away',
  periodFormat: 'quarters',
  currentPeriod: 4,
  status: 'final',
  teamScore: 45,
  opponentScore: 0,
  notes: 'Great game',
  createdAt: 1,
  updatedAt: 1,
};

const bare: Game = {
  id: 'g2',
  playerId: 'p1',
  opponent: 'Lincoln',
  date: '2026-09-20',
  periodFormat: 'halves',
  currentPeriod: 1,
  status: 'live',
  createdAt: 1,
  updatedAt: 1,
};

function form(overrides: Partial<GameForm> = {}): GameForm {
  return { ...gameFormFrom(game), ...overrides };
}

describe('gameFormFrom', () => {
  it("fills the fields with the game's details", () => {
    expect(gameFormFrom(game)).toEqual({
      opponent: 'Central',
      date: '2026-09-27',
      season: 'Fall 2026',
      venue: 'away',
      teamScore: '45',
      opponentScore: '0',
      notes: 'Great game',
    });
  });

  it('leaves fields empty for details the game does not have', () => {
    expect(gameFormFrom(bare)).toEqual({
      opponent: 'Lincoln',
      date: '2026-09-20',
      season: '',
      venue: 'unset',
      teamScore: '',
      opponentScore: '',
      notes: '',
    });
  });
});

describe('validateGameForm', () => {
  it('turns the fields into a patch that names every detail', () => {
    expect(
      validateGameForm(form({ opponent: '  Central Catholic ', teamScore: ' 52 ', notes: ' Hi ' })),
    ).toEqual({
      ok: true,
      patch: {
        opponent: 'Central Catholic',
        date: '2026-09-27',
        season: 'Fall 2026',
        homeAway: 'away',
        teamScore: 52,
        opponentScore: 0,
        notes: 'Hi',
      },
    });
  });

  it('clears emptied details with null, so they are not kept', () => {
    const result = validateGameForm(
      form({ season: ' ', venue: 'unset', teamScore: '', opponentScore: '  ', notes: '\n' }),
    );
    expect(result).toEqual({
      ok: true,
      patch: {
        opponent: 'Central',
        date: '2026-09-27',
        season: null,
        homeAway: null,
        teamScore: null,
        opponentScore: null,
        notes: null,
      },
    });
  });

  it('requires the opponent', () => {
    expect(validateGameForm(form({ opponent: '   ' }))).toEqual({
      ok: false,
      errors: { opponent: 'Enter the opponent' },
    });
  });

  it('requires a real date', () => {
    expect(validateGameForm(form({ date: '' }))).toEqual({
      ok: false,
      errors: { date: 'Pick the date of the game' },
    });
    expect(validateGameForm(form({ date: '2026-02-30' }))).toEqual({
      ok: false,
      errors: { date: 'Enter a real date' },
    });
  });

  it('accepts only whole-number scores from 0 to the highest score stored', () => {
    expect(MAX_SCORE).toBe(999);
    for (const bad of ['-1', '4.5', '1e2', 'abc', String(MAX_SCORE + 1)]) {
      const result = validateGameForm(form({ teamScore: bad, opponentScore: bad }));
      expect(result.ok, bad).toBe(false);
      expect(result.ok ? null : result.errors, bad).toEqual({
        teamScore: 'Enter a number from 0 to 999',
        opponentScore: 'Enter a number from 0 to 999',
      });
    }
    const highest = validateGameForm(form({ teamScore: String(MAX_SCORE), opponentScore: '007' }));
    expect(highest.ok && highest.patch).toMatchObject({ teamScore: MAX_SCORE, opponentScore: 7 });
  });

  it('leaves the score out, so it is kept, when the form has no score fields', () => {
    // A live game: whatever is in the (hidden) score fields is ignored.
    const result = validateGameForm(form({ teamScore: 'junk', opponentScore: '' }), {
      withScores: false,
    });
    expect(result).toEqual({
      ok: true,
      patch: {
        opponent: 'Central',
        date: '2026-09-27',
        season: 'Fall 2026',
        homeAway: 'away',
        notes: 'Great game',
      },
    });
    expect(result.ok && Object.keys(result.patch)).not.toContain('teamScore');
  });

  it('rejects text longer than the data layer stores', () => {
    const result = validateGameForm(
      form({
        opponent: 'x'.repeat(TEXT_LIMITS.opponent + 1),
        season: 'x'.repeat(TEXT_LIMITS.season + 1),
        notes: 'x'.repeat(TEXT_LIMITS.notes + 1),
      }),
    );
    expect(result.ok ? null : Object.keys(result.errors)).toEqual(['opponent', 'season', 'notes']);
  });
});
