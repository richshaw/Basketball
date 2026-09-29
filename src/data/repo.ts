/**
 * The only way screens read and write data (reactive reads live in hooks.ts).
 *
 * Every write runs in one Dexie transaction, validates the records it stores, bumps
 * the affected game's `updatedAt` and bumps `meta.lastChangeAt`, which the backup
 * watches. Getters return `undefined` for a missing record (hooks return `null`).
 * Invalid input (a bug in the caller) rejects with a TypeError; a missing game
 * rejects with an Error.
 *
 * Changing an existing record, everywhere: a field that's missing or `undefined`
 * keeps its value, and `null` or '' clears it.
 */
import { Dexie } from 'dexie';
import { clampToHalfCourt, isRealPoint } from '@/lib/court';
import { newId } from '@/lib/id';
import { db, eventsOfGame, META_KEYS, nextTimestamp, touchLastChange } from './db';
import { removePendingRemoval } from './pendingRemovals';
import { removePendingSpot } from './pendingSpots';
import { forgetPendingStat, forgetPendingStats } from './pendingStats';
import { isFieldGoalType } from './stats';
import {
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

/** A changed optional text field: undefined keeps `current`; null or '' clears it. */
function patchText(
  current: string | undefined,
  value: string | null | undefined,
): string | undefined {
  return value === undefined ? current : optionalText(value);
}

/** A changed optional field: undefined keeps `current`; null or '' clears it. */
function patchValue<T>(current: T | undefined, value: T | null | undefined): T | undefined {
  if (value === undefined) return current;
  return value === null || value === '' ? undefined : value;
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
  /** Leave it out (or undefined) to keep the current number; null or '' clears it. */
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
        name: input.name === undefined ? (existing?.name ?? '') : (input.name ?? '').trim(),
        jerseyNumber: patchText(existing?.jerseyNumber, input.jerseyNumber),
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
        homeAway: input.homeAway || undefined,
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
 * Changes to a game's details. A key that's missing or undefined keeps its value;
 * null or '' clears an optional one (clearing a required one is rejected).
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
  // Required fields: null or '' "clears" them, which validation then rejects.
  if (patch.opponent !== undefined) next.opponent = (patch.opponent ?? '').trim();
  if (patch.date !== undefined) next.date = patch.date;
  if (patch.periodFormat !== undefined) next.periodFormat = patch.periodFormat;
  next.season = patchText(game.season, patch.season);
  next.homeAway = patchValue(game.homeAway, patch.homeAway);
  next.teamScore = patchValue(game.teamScore, patch.teamScore);
  next.opponentScore = patchValue(game.opponentScore, patch.opponentScore);
  next.notes = patchText(game.notes, patch.notes);
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
 * scores that are given. A score that's missing or undefined keeps its current
 * value; null clears it.
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

/**
 * Deletes a game and all of its stats, and forgets its taps not saved yet and the spots
 * kept for its stats (the shot chart; see forgetPendingStats). Does nothing else if the
 * game doesn't exist.
 */
export function deleteGame(gameId: string): Promise<void> {
  // First: then no retry can save one of its taps (or spots) once it's gone, e.g. into
  // the game restored from a backup later.
  const keepAgain = forgetPendingStats(gameId);
  return deleteGameRecords(gameId).catch((error: unknown) => {
    keepAgain();
    throw error;
  });
}

/**
 * Deletes a game and all of its stats like deleteGame, but forgets nothing kept for
 * them: for a write that forgets them itself, once, and keeps them again if it fails
 * (removeDemoData). Forgetting them again in its midst would leave them forgotten for
 * good if the write failed after this part of it.
 */
export function deleteGameRecords(gameId: string): Promise<void> {
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

/**
 * Checks that a stat of `type` may have a location, and clamps it onto the half
 * court. A point that isn't real (NaN or Infinity, e.g. measured on a court drawn
 * at zero size) is dropped rather than rejected, so it can never cost the tap.
 */
function shotLocation(
  type: StatType,
  location: CourtPoint | null | undefined,
): CourtPoint | undefined {
  if (location == null) return undefined;
  if (!isFieldGoalType(type)) {
    throw new TypeError(`Only 2PT and 3PT shots can have a location, not ${type}`);
  }
  if (!isRealPoint(location)) return undefined;
  const { x, y } = clampToHalfCourt(location);
  // Store -0 as 0: JSON (and so a backup) can't tell them apart.
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** Bumps a game's updatedAt; must run inside a write transaction. */
async function touchGame(gameId: string, now: number): Promise<void> {
  const game = await db.games.get(gameId);
  if (game) await db.games.put({ ...game, updatedAt: nextTimestamp(now, game.updatedAt) });
}

export interface RecordStatOptions {
  /**
   * The stat's id, made at the tap, so saving the same tap again (a retry after a
   * write that seemed to fail but landed) can never add it twice: if a stat with this
   * id already exists, it's returned as it is and nothing is written.
   */
  id?: string;
  /**
   * When it was tapped (epoch ms), used as its `createdAt`, so it sorts where it was
   * tapped however late it's saved. Make it with `nextTimestamp` after the game's
   * latest stat; if another stat of the game already has that time, the free
   * millisecond just after it (or else just before it) is used, so it still sorts
   * between the stats tapped before and after it. Leave it out for "now", just after
   * the game's latest stat.
   */
  at?: number;
  /**
   * The period the stat belongs to (1 to MAX_PERIOD), e.g. the one on screen when it
   * was tapped. Leave it out for the game's current period.
   */
  period?: number;
}

/**
 * A time for a stat tapped at `at` that no other stat of the game has: `at`, else the
 * millisecond just after it, else the one just before it. Either way it keeps its place
 * among the stats tapped before and after it (one tapped in the same millisecond may
 * end up on either side). Only if all three are taken (stats in three milliseconds in a
 * row, e.g. from two tabs) does it move on to the next free millisecond after them,
 * past a stat or two tapped a moment later.
 */
async function freeTimestamp(gameId: string, at: number): Promise<number> {
  const taken = async (time: number) =>
    (await db.events.where('[gameId+createdAt]').equals([gameId, time]).count()) > 0;
  if (!(await taken(at))) return at;
  if (!(await taken(at + 1))) return at + 1;
  if (at > 0 && !(await taken(at - 1))) return at - 1;
  let time = at + 2;
  while (await taken(time)) time += 1;
  return time;
}

/**
 * Records one stat, in the game's current period unless `options.period` says
 * otherwise (the game's current period stays as it is). `location` (feet, see
 * CourtPoint) is only allowed on 2PT/3PT shots and is clamped onto the half court;
 * a location that isn't a real point is dropped and the stat is still saved. Works
 * on final games too, for corrections. With `options.id` it's idempotent: a stat
 * already saved under that id is returned without writing or bumping anything.
 */
export function recordStat(
  gameId: string,
  type: StatType,
  location?: CourtPoint | null,
  options: RecordStatOptions = {},
): Promise<StatEvent> {
  return db.transaction('rw', [db.games, db.events, db.meta], async () => {
    if (!(STAT_TYPES as readonly string[]).includes(type)) {
      throw new TypeError(`Unknown stat type: ${String(type)}`);
    }
    const shot = shotLocation(type, location);

    if (options.id !== undefined) {
      const saved = await db.events.get(options.id);
      if (saved) {
        if (saved.gameId !== gameId || saved.type !== type) {
          throw new TypeError(`Stat id ${options.id} belongs to another stat`);
        }
        return saved;
      }
    }

    const now = Date.now();
    const game = await requireGame(gameId);
    // Without a tap time: strictly after the game's latest stat, even for taps in the
    // same millisecond.
    const createdAt =
      options.at ?? nextTimestamp(now, (await eventsOfGame(gameId).last())?.createdAt);
    const event = validRecord(
      statEventSchema,
      {
        id: options.id ?? newId(),
        gameId,
        type,
        // Checked like setCurrentPeriod's: a whole number from 1 to MAX_PERIOD.
        period: options.period ?? game.currentPeriod,
        createdAt,
        location: shot,
      },
      'stat',
    );
    // A tap time (checked as a timestamp just above) that no other stat of the game has.
    if (options.at !== undefined) event.createdAt = await freeTimestamp(gameId, createdAt);
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
 * A point that isn't real (NaN or Infinity) rejects; the stat itself stays saved.
 */
export function setStatLocation(
  eventId: string,
  location: CourtPoint | null,
): Promise<StatEvent | undefined> {
  return db.transaction('rw', [db.games, db.events, db.meta], async () => {
    const event = await db.events.get(eventId);
    // undefined keeps the current location: nothing to do.
    if (!event || location === undefined) return event;
    if (location !== null && !isRealPoint(location)) {
      throw new TypeError('A shot location must be finite numbers of feet');
    }
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
    if (last) {
      // Its tap, if one is still kept, must never be saved again.
      forgetPendingStat(last.id);
      await removeEvent(last, Date.now());
    }
    return last;
  });
}

/**
 * Removes one event (e.g. from the event log), and forgets its tap if one is still
 * kept, so it can't be saved again, and the spot kept for it (the shot chart) and the
 * removal kept for it (a tap taken back while the database couldn't be written).
 * Resolves to it, or undefined if missing.
 */
export async function deleteStat(eventId: string): Promise<StatEvent | undefined> {
  // First: then no retry can save it once it's gone.
  forgetPendingStat(eventId);
  const event = await db.transaction('rw', [db.games, db.events, db.meta], async () => {
    const found = await db.events.get(eventId);
    if (found) await removeEvent(found, Date.now());
    return found;
  });
  // Its spot goes only once it's gone: a spot never brings back its stat, and a stat
  // that stays (the delete failed) still gets it. So does a kept removal: it's done.
  removePendingSpot(eventId);
  removePendingRemoval(eventId);
  return event;
}

// ---------------------------------------------------------------------------
// Settings and change tracking

/**
 * Each setting the schema knows, from the stored value when that field is valid on
 * its own, else its default. Driven by settingsSchema, so a new setting is read
 * (and exported) without touching this.
 */
function resolveSettings(stored: unknown): Settings {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  if (typeof stored === 'object' && stored !== null) {
    for (const [key, field] of Object.entries(settingsSchema.shape)) {
      const result = field.safeParse((stored as Record<string, unknown>)[key]);
      if (result.success && result.data !== undefined) settings[key] = result.data;
    }
  }
  return settings as unknown as Settings;
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
  /** Missing or undefined keeps it; null or '' clears it. */
  lastSeason?: string | null;
}

/**
 * Changes some settings: a key that's missing or undefined keeps its value.
 * Resolves to the new settings.
 */
export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return db.transaction('rw', [db.meta], async () => {
    const now = Date.now();
    const next = await getSettings();
    if (patch.shotChart !== undefined) next.shotChart = patch.shotChart;
    if (patch.defaultPeriodFormat !== undefined) {
      next.defaultPeriodFormat = patch.defaultPeriodFormat;
    }
    next.lastSeason = patchText(next.lastSeason, patch.lastSeason);
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

/**
 * Calls `listener` as soon as a write to the data commits, in this tab or another:
 * before the hooks have re-read anything. Returns a function that stops it. For code
 * that keeps its own copy of the data, e.g. a backup file ready to share from a tap.
 */
export function subscribeToChanges(listener: () => void): () => void {
  const onMutated = () => {
    listener();
  };
  Dexie.on.storagemutated.subscribe(onMutated);
  return () => {
    Dexie.on.storagemutated.unsubscribe(onMutated);
  };
}
