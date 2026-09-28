/**
 * The "Edit game" form as plain data: what the fields hold, how they're checked, and
 * the `updateGame` patch they turn into. Pure: no React, no database.
 */
import type { GamePatch } from '@/data/repo';
import { TEXT_LIMITS, type Game, type HomeAway } from '@/data/types';
import { isLocalISODate } from '@/lib/format';

/** `'unset'` selects no segment: the game doesn't say where it was played. */
export type Venue = HomeAway | 'unset';

export type ScoreField = 'teamScore' | 'opponentScore';

/** The field values, exactly as typed. */
export interface GameForm {
  opponent: string;
  date: string;
  season: string;
  venue: Venue;
  teamScore: string;
  opponentScore: string;
  notes: string;
}

export type GameFormErrors = Partial<Record<keyof GameForm, string>>;

export type GameFormResult = { ok: true; patch: GamePatch } | { ok: false; errors: GameFormErrors };

/** Highest score the data layer accepts. */
export const MAX_SCORE = 999;

function scoreText(score: number | undefined): string {
  return score === undefined ? '' : String(score);
}

/** The form filled in with a game's current details. */
export function gameFormFrom(game: Game): GameForm {
  return {
    opponent: game.opponent,
    date: game.date,
    season: game.season ?? '',
    venue: game.homeAway ?? 'unset',
    teamScore: scoreText(game.teamScore),
    opponentScore: scoreText(game.opponentScore),
    notes: game.notes ?? '',
  };
}

/** '' is "no score"; otherwise a whole number from 0 to 999, or undefined if it isn't one. */
function parseScore(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const score = Number(trimmed);
  return score <= MAX_SCORE ? score : undefined;
}

const SCORE_ERROR = `Enter a number from 0 to ${MAX_SCORE}`;

/**
 * Checks the form. Valid: the patch for `updateGame`, which names every field so an
 * emptied one is cleared (null) rather than kept. Invalid: a message per bad field.
 */
export function validateGameForm(form: GameForm): GameFormResult {
  const errors: GameFormErrors = {};
  const opponent = form.opponent.trim();
  if (!opponent) errors.opponent = 'Enter the opponent';
  else if (opponent.length > TEXT_LIMITS.opponent) {
    errors.opponent = `Use at most ${TEXT_LIMITS.opponent} characters`;
  }

  if (!form.date) errors.date = 'Pick the date of the game';
  else if (!isLocalISODate(form.date)) errors.date = 'Enter a real date';

  const season = form.season.trim();
  if (season.length > TEXT_LIMITS.season) {
    errors.season = `Use at most ${TEXT_LIMITS.season} characters`;
  }

  const teamScore = parseScore(form.teamScore);
  if (teamScore === undefined) errors.teamScore = SCORE_ERROR;
  const opponentScore = parseScore(form.opponentScore);
  if (opponentScore === undefined) errors.opponentScore = SCORE_ERROR;

  const notes = form.notes.trim();
  if (notes.length > TEXT_LIMITS.notes) {
    errors.notes = `Use at most ${TEXT_LIMITS.notes} characters`;
  }

  if (teamScore === undefined || opponentScore === undefined || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    patch: {
      opponent,
      date: form.date,
      season: season || null,
      homeAway: form.venue === 'unset' ? null : form.venue,
      teamScore,
      opponentScore,
      notes: notes || null,
    },
  };
}
