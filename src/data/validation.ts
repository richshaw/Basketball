/**
 * Runtime schemas for every stored record. The repository validates each record
 * before writing it and the importer validates every backup with the same schemas,
 * so anything the app writes can always be restored from a backup.
 *
 * Uses zod/mini (tree-shakable) to keep the bundle small.
 */
import * as z from 'zod/mini';
import { BASELINE_Y, HALF_COURT_LINE_Y, SIDELINE_X } from '@/lib/court';
import { isLocalISODate } from '@/lib/format';
import { isFieldGoalType } from './stats';
import {
  GAME_STATUSES,
  HOME_AWAY,
  MAX_PERIOD,
  PERIOD_FORMATS,
  STAT_TYPES,
  TEXT_LIMITS,
  type Game,
  type Player,
  type Settings,
  type StatEvent,
} from './types';

export const MAX_ID_LENGTH = 100;

const id = z
  .string()
  .check(z.minLength(1, 'Missing id'), z.maxLength(MAX_ID_LENGTH, 'Id too long'));
/** Epoch milliseconds. */
const timestamp = z.int('Expected a timestamp').check(z.nonnegative('Expected a timestamp'));
const text = (max: number) => z.string().check(z.maxLength(max, `Longer than ${max} characters`));
const requiredText = (max: number) =>
  z.string().check(z.minLength(1, 'Required'), z.maxLength(max, `Longer than ${max} characters`));
const localDate = z.string().check(z.refine(isLocalISODate, 'Expected a date like 2026-09-27'));
const period = z
  .int('Expected a period number')
  .check(z.minimum(1, 'Period below 1'), z.maximum(MAX_PERIOD, `Period above ${MAX_PERIOD}`));
const score = z
  .int('Expected a score')
  .check(z.minimum(0, 'Negative score'), z.maximum(999, 'Score above 999'));

export const courtPointSchema = z.object({
  x: z.number().check(z.minimum(-SIDELINE_X), z.maximum(SIDELINE_X)),
  y: z.number().check(z.minimum(BASELINE_Y), z.maximum(HALF_COURT_LINE_Y)),
});

export const playerSchema = z.object({
  id,
  name: text(TEXT_LIMITS.playerName),
  jerseyNumber: z.optional(requiredText(TEXT_LIMITS.jerseyNumber)),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const gameSchema = z.object({
  id,
  playerId: id,
  opponent: requiredText(TEXT_LIMITS.opponent),
  date: localDate,
  season: z.optional(requiredText(TEXT_LIMITS.season)),
  homeAway: z.optional(z.enum(HOME_AWAY)),
  periodFormat: z.enum(PERIOD_FORMATS),
  currentPeriod: period,
  status: z.enum(GAME_STATUSES),
  teamScore: z.optional(score),
  opponentScore: z.optional(score),
  notes: z.optional(requiredText(TEXT_LIMITS.notes)),
  createdAt: timestamp,
  updatedAt: timestamp,
  endedAt: z.optional(timestamp),
});

export const statEventSchema = z
  .object({
    id,
    gameId: id,
    type: z.enum(STAT_TYPES),
    period,
    createdAt: timestamp,
    location: z.optional(courtPointSchema),
  })
  .check(
    z.refine((event) => event.location === undefined || isFieldGoalType(event.type), {
      message: 'Only 2PT and 3PT shots can have a location',
      path: ['location'],
    }),
  );

export const settingsSchema = z.object({
  shotChart: z.boolean(),
  defaultPeriodFormat: z.enum(PERIOD_FORMATS),
  lastSeason: z.optional(requiredText(TEXT_LIMITS.season)),
});

/** 'games[3].date: Expected a date like 2026-09-27' */
export function describeIssue(issue: z.core.$ZodIssue): string {
  let path = '';
  for (const key of issue.path) {
    path += typeof key === 'number' ? `[${key}]` : `${path ? '.' : ''}${String(key)}`;
  }
  let message = issue.message;
  if (message === 'Invalid input') {
    // zod/mini ships without English messages; describe the common cases.
    if (issue.code === 'invalid_type') message = `Expected ${issue.expected}`;
    else if (issue.code === 'invalid_value') message = `Expected ${issue.values.join(' or ')}`;
  }
  return path ? `${path}: ${message}` : message;
}

/** Removes keys whose value is undefined, so stored records stay clean. */
export function withoutUndefined<T extends object>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}

/**
 * Validates a record the app is about to write; throws a descriptive error if it's
 * invalid (a bug or bad input from a screen). Returns a clean copy.
 */
export function validRecord<T extends object>(
  schema: z.ZodMiniType<T>,
  record: T,
  what: string,
): T {
  const result = schema.safeParse(record);
  if (!result.success) {
    const problems = result.error.issues.map(describeIssue).join('; ');
    throw new TypeError(`Invalid ${what}: ${problems}`);
  }
  return withoutUndefined(result.data);
}

// Compile-time guard: each schema must describe exactly its model type, so no field
// can be silently dropped by a backup round trip. `npm run typecheck` fails otherwise.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Matches<A, B> =
  Same<A, B> extends true
    ? Same<keyof A, keyof B> extends true
      ? Same<Required<A>, Required<B>>
      : false
    : false;
type Check<T extends true> = T;
export type SchemasMatchModel = [
  Check<Matches<z.output<typeof playerSchema>, Player>>,
  Check<Matches<z.output<typeof gameSchema>, Game>>,
  Check<Matches<z.output<typeof statEventSchema>, StatEvent>>,
  Check<Matches<z.output<typeof settingsSchema>, Settings>>,
];
