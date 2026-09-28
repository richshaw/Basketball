/**
 * The only way screens read and write data (reactive reads live in hooks.ts).
 *
 * Every write runs in one Dexie transaction, validates the records it stores, bumps
 * the affected game's `updatedAt` and bumps `meta.lastChangeAt`, which the backup
 * watches. Getters return `undefined` for a missing record (hooks return `null`).
 * Invalid input (a bug in the caller) rejects with a TypeError; a missing game
 * rejects with an Error.
 */
import { clampToHalfCourt } from '@/lib/court';
import { newId } from '@/lib/id';
import { db, eventsOfGame, META_KEYS, nextTimestamp, touchLastChange } from './db';
import { isFieldGoalType } from './stats';
import {
  PERIOD_FORMATS,
  STAT_TYPES,
  type CourtPoint,
  type Game,
  type HomeAway,
  type PeriodFormat,
  type Player,
  type Settings,
  type StatEvent,
  type StatType,
} from './types';
import {
  gameSchema,
  playerSchema,
  settingsSchema,
  statEventSchema,
  validRecord,
} from './validation';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  shotChart: true,
  defaultPeriodFormat: 'quarters',
});

/** Trims text; empty (or null/undefined) becomes undefined, i.e. "not set". */
function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Player

/**
 * The player whose stats are recorded. There's only ever one; if a restored backup
 * somehow holds several, the first one created counts.
 */
export function primaryPlayer(players: readonly Player[]): Player | undefined {
  let primary: Player | undefined;
  for (const player of players) {
    if (
      !primary ||
      player.createdAt < primary.createdAt ||
      (player.createdAt === primary.createdAt && player.id < primary.id)
    ) {
      primary = player;
    }
  }
  return primary;
}

export async function getPlayer(): Promise<Player | undefined> {
  return primaryPlayer(await db.players.toArray());
}

export interface PlayerInput {
  name: string;
  /** Empty, null or missing clears it. */
  jerseyNumber?: string | null;
}

/** Saves the player's details, creating the player on first use. */
export function savePlayer(input: PlayerInput): Promise<Player> {
  return db.transaction('rw', [db.players, db.meta], async () => {
    const now = Date.now();
    const existing = await getPlayer();
    const player = validRecord(
      playerSchema,
      {
        id: existing?.id ?? newId(),
        name: input.name.trim(),
        jerseyNumber: optionalText(input.jerseyNumber),
        createdAt: existing?.createdAt ?? now,
        updatedAt: nextTimestamp(now, existing?.updatedAt),
      },
      'player',
    );
    await db.players.put(player);
    await touchLastChange(now);
    return player;
  });
}

// ---------------------------------------------------------------------------
// Games

/** Newest first: by date, then by when the game was created. */
export function compareGamesNewestFirst(a: Game, b: Game): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function getGame(id: string): Promise<Game | undefined> {
  return db.games.get(id);
}

async function requireGame(id: string): Promise<Game> {
  const game = await db.games.get(id);
  if (!game) throw new Error(`Game not found: ${id}`);
  return game;
}

/** All games, newest first (date desc, then createdAt desc). */
export async function listGames(): Promise<Game[]> {
  return (await db.games.toArray()).sort(compareGamesNewestFirst);
}

/** The live game updated most recently (normally the only live game). */
export async function getLiveGame(): Promise<Game | undefined> {
  const live = await db.games.where('status').equals('live').toArray();
  return live.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)[0];
}

/** Distinct season labels, most recent first (by each season's latest game). */
export async function listSeasons(): Promise<string[]> {
  const seasons = new Set<string>();
  for (const game of await listGames()) {
    if (game.season) seasons.add(game.season);
  }
  return [...seasons];
}

export interface NewGame {
  opponent: string;
  /** Local 'YYYY-MM-DD' (see todayLocalISO). */
  date: string;
  season?: string | null;
  homeAway?: HomeAway | null;
  periodFormat: PeriodFormat;
}

/**
 * Starts a live game in period 1. Creates the player (with no name yet) if there
 * isn't one, and remembers the period format and season (when one is given) as the
 * defaults for the next new game.
 */
export function createGame(input: NewGame): Promise<Game> {
  return db.transaction('rw', [db.players, db.games, db.meta], async () => {
    const now = Date.now();
    let player = await getPlayer();
    if (!player) {
      player = validRecord(
        playerSchema,
        { id: newId(), name: '', createdAt: now, updatedAt: now },
        'player',
      );
      await db.players.add(player);
    }

    const game = validRecord(
      gameSchema,
      {
        id: newId(),
        playerId: player.id,
        opponent: input.opponent.trim(),
        date: input.date,
        season: optionalText(input.season),
        homeAway: input.homeAway ?? undefined,
        periodFormat: input.periodFormat,
        currentPeriod: 1,
        status: 'live',
        createdAt: now,
        updatedAt: now,
      },
      'game',
    );
    await db.games.add(game);

    const settings = await getSettings();
    await putSettings({
      ...settings,
      defaultPeriodFormat: game.periodFormat,
      lastSeason: game.season ?? settings.lastSeason,
    });
    await touchLastChange(now);
    return game;
  });
}

/**
 * Changes to a game's details. Leave a key out to keep its value; pass null (or
 * undefined, or '' for text) to clear an optional one.
 */
export interface GamePatch {
  opponent?: string;
  date?: string;
  season?: string | null;
  homeAway?: HomeAway | null;
  periodFormat?: PeriodFormat;
  teamScore?: number | null;
  opponentScore?: number | null;
  notes?: string | null;
}

function applyGamePatch(game: Game, patch: GamePatch): Game {
  const next: Game = { ...game };
  if (patch.opponent !== undefined) next.opponent = patch.opponent.trim();
  if (patch.date !== undefined) next.date = patch.date;
  if (patch.periodFormat !== undefined) next.periodFormat = patch.periodFormat;
  if ('season' in patch) next.season = optionalText(patch.season);
  if ('homeAway' in patch) next.homeAway = patch.homeAway ?? undefined;
  if ('teamScore' in patch) next.teamScore = patch.teamScore ?? undefined;
  if ('opponentScore' in patch) next.opponentScore = patch.opponentScore ?? undefined;
  if ('notes' in patch) next.notes = optionalText(patch.notes);
  return next;
}

/** Loads a game, applies `change`, validates and saves it, bumping updatedAt. */
function modifyGame(id: string, change: (game: Game, now: number) => Game): Promise<Game> {
  return db.transaction('rw', [db.games, db.meta], async () => {
    const now = Date.now();
    const game = await requireGame(id);
    const next = validRecord(
      gameSchema,
      { ...change(game, now), id: game.id, updatedAt: nextTimestamp(now, game.updatedAt) },
      'game',
    );
    await db.games.put(next);
    await touchLastChange(now);
    return next;
  });
}

/** Edits a game's details (see GamePatch). */
export function updateGame(id: string, patch: GamePatch): Promise<Game> {
  return modifyGame(id, (game) => applyGamePatch(game, patch));
}

/** Moves the game to another period (1-based; past regulation is overtime). */
export function setCurrentPeriod(gameId: string, period: number): Promise<Game> {
  return modifyGame(gameId, (game) => ({ ...game, currentPeriod: period }));
}

export interface FinalScore {
  teamScore?: number | null;
  opponentScore?: number | null;
}

/**
 * Marks the game final (endedAt = now, kept if it was already final) and sets the
 * scores that are given; a score left out keeps its current value.
 */
export function endGame(gameId: string, score: FinalScore = {}): Promise<Game> {
  return modifyGame(gameId, (game, now) => ({
    ...applyGamePatch(game, score),
    status: 'final',
    endedAt: game.status === 'final' ? (game.endedAt ?? now) : now,
  }));
}

/** Makes a final game live again (e.g. it was ended by mistake). Scores are kept. */
export function reopenGame(gameId: string): Promise<Game> {
  return modifyGame(gameId, (game) => ({ ...game, status: 'live', endedAt: undefined }));
}

/** Deletes a game and all of its stats. Does nothing if the game doesn't exist. */
export function deleteGame(gameId: string): Promise<void> {
  return db.transaction('rw', [db.games, db.events, db.meta], async () => {
    const game = await db.games.get(gameId);
    const deletedEvents = await db.events.where('gameId').equals(gameId).delete();
    if (!game && deletedEvents === 0) return;
    await db.games.delete(gameId);
    await touchLastChange(Date.now());
  });
}

// ---------------------------------------------------------------------------
// Stat events

/** A game's events, oldest first. */
export function getGameEvents(gameId: string): Promise<StatEvent[]> {
  return eventsOfGame(gameId).toArray();
}

/** Every event of every game (for season stats), grouped by game, oldest first. */
export function getAllEvents(): Promise<StatEvent[]> {
  return db.events.orderBy('[gameId+createdAt]').toArray();
}

/** Checks that a stat of `type` may have a location, and clamps it onto the half court. */
function shotLocation(
  type: StatType,
  location: CourtPoint | null | undefined,
): CourtPoint | undefined {
  if (location == null) return undefined;
  if (!isFieldGoalType(type)) {
    throw new TypeError(`Only 2PT and 3PT shots can have a location, not ${type}`);
  }
  const { x, y } = clampToHalfCourt(location);
  // Store -0 as 0: JSON (and so a backup) can't tell them apart.
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** Bumps a game's updatedAt; must run inside a write transaction. */
async function touchGame(gameId: string, now: number): Promise<void> {
  const game = await db.games.get(gameId);
  if (game) await db.games.put({ ...game, updatedAt: nextTimestamp(now, game.updatedAt) });
}

/**
 * Records one stat in the game's current period. `location` (feet, see CourtPoint)
 * is only allowed on 2PT/3PT shots and is clamped onto the half court. Works on
 * final games too, for corrections.
 */
export function recordStat(
  gameId: string,
  type: StatType,
  location?: CourtPoint | null,
): Promise<StatEvent> {
  return db.transaction('rw', [db.games, db.events, db.meta], async () => {
    if (!(STAT_TYPES as readonly string[]).includes(type)) {
      throw new TypeError(`Unknown stat type: ${String(type)}`);
    }
    const shot = shotLocation(type, location);

    const now = Date.now();
    const game = await requireGame(gameId);
    const last = await eventsOfGame(gameId).last();
    const event = validRecord(
      statEventSchema,
      {
        id: newId(),
        gameId,
        type,
        period: game.currentPeriod,
        // Strictly increasing within the game, even for taps in the same millisecond.
        createdAt: nextTimestamp(now, last?.createdAt),
        location: shot,
      },
      'stat',
    );
    await db.events.add(event);
    await db.games.put({ ...game, updatedAt: nextTimestamp(now, game.updatedAt) });
    await touchLastChange(now);
    return event;
  });
}

/**
 * Sets where a recorded 2PT/3PT shot was taken (null removes it). For a shot chart
 * that asks for the spot after the stat is saved, so the tap itself is never lost.
 * Resolves to the updated event, or undefined if it's gone (e.g. undone meanwhile).
 */
export function setStatLocation(
  eventId: string,
  location: CourtPoint | null,
): Promise<StatEvent | undefined> {
  return db.transaction('rw', [db.games, db.events, db.meta], async () => {
    const event = await db.events.get(eventId);
    if (!event) return undefined;
    const now = Date.now();
    const updated = validRecord(
      statEventSchema,
      { ...event, location: shotLocation(event.type, location) },
      'stat',
    );
    await db.events.put(updated);
    await touchGame(event.gameId, now);
    await touchLastChange(now);
    return updated;
  });
}

/** Removes an event and bumps its game's updatedAt; must run inside a write transaction. */
async function removeEvent(event: StatEvent, now: number): Promise<void> {
  await db.events.delete(event.id);
  await touchGame(event.gameId, now);
  await touchLastChange(now);
}

/** Removes the game's most recent event. Resolves to it, or undefined if there was none. */
export function undoLastStat(gameId: string): Promise<StatEvent | undefined> {
  return db.transaction('rw', [db.games, db.events, db.meta], async () => {
    const last = await eventsOfGame(gameId).last();
    if (last) await removeEvent(last, Date.now());
    return last;
  });
}

/** Removes one event (e.g. from the event log). Resolves to it, or undefined if missing. */
export function deleteStat(eventId: string): Promise<StatEvent | undefined> {
  return db.transaction('rw', [db.games, db.events, db.meta], async () => {
    const event = await db.events.get(eventId);
    if (event) await removeEvent(event, Date.now());
    return event;
  });
}

// ---------------------------------------------------------------------------
// Settings and change tracking

function isPeriodFormat(value: unknown): value is PeriodFormat {
  return (PERIOD_FORMATS as readonly unknown[]).includes(value);
}

/** Defaults, overridden by each valid stored value. */
function resolveSettings(stored: unknown): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (typeof stored !== 'object' || stored === null) return settings;
  const { shotChart, defaultPeriodFormat, lastSeason } = stored as Record<string, unknown>;
  if (typeof shotChart === 'boolean') settings.shotChart = shotChart;
  if (isPeriodFormat(defaultPeriodFormat)) settings.defaultPeriodFormat = defaultPeriodFormat;
  if (typeof lastSeason === 'string' && lastSeason) settings.lastSeason = lastSeason;
  return settings;
}

/** The app settings, with defaults for anything never set. */
export async function getSettings(): Promise<Settings> {
  return resolveSettings((await db.meta.get(META_KEYS.settings))?.value);
}

/** Validates and stores the settings; must run inside a write transaction. */
async function putSettings(settings: Settings): Promise<Settings> {
  const valid = validRecord(settingsSchema, settings, 'settings');
  await db.meta.put({ key: META_KEYS.settings, value: valid });
  return valid;
}

export interface SettingsPatch {
  shotChart?: boolean;
  defaultPeriodFormat?: PeriodFormat;
  /** null, undefined or '' clears it. */
  lastSeason?: string | null;
}

/** Changes some settings (keys left out keep their value). Resolves to the new settings. */
export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return db.transaction('rw', [db.meta], async () => {
    const now = Date.now();
    const next = await getSettings();
    if (patch.shotChart !== undefined) next.shotChart = patch.shotChart;
    if (patch.defaultPeriodFormat !== undefined) {
      next.defaultPeriodFormat = patch.defaultPeriodFormat;
    }
    if ('lastSeason' in patch) next.lastSeason = optionalText(patch.lastSeason);
    const settings = await putSettings(next);
    await touchLastChange(now);
    return settings;
  });
}

/**
 * When the stats data last changed (epoch ms, strictly increasing), or undefined if
 * it never has. For the backup: read this BEFORE exporting, so a write that lands
 * during the export shows up as a newer change instead of being missed.
 */
export async function getLastChangeAt(): Promise<number | undefined> {
  const record = await db.meta.get(META_KEYS.lastChangeAt);
  return typeof record?.value === 'number' ? record.value : undefined;
}
