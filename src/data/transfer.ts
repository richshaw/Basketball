/**
 * Export and import of all data as one JSON-friendly object. Shared by the file
 * backup and the encrypted cloud backup, so a round trip must be exact:
 * `importAll(parseExportFile(JSON.parse(JSON.stringify(await exportAll()))), 'replace')`
 * restores exactly what was exported.
 */
import * as z from 'zod/mini';
import { db, META_KEYS, touchLastChange } from './db';
import { getSettings, primaryPlayer } from './repo';
import type { Game, Player, Settings, StatEvent } from './types';
import {
  describeIssue,
  gameSchema,
  playerSchema,
  settingsSchema,
  statEventSchema,
  withoutUndefined,
} from './validation';

export const EXPORT_APP = 'hoop-stats';
/** Bump when the file format changes, and teach parseExportFile to upgrade older files. */
export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportFile {
  app: typeof EXPORT_APP;
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  /** When the export was made (ISO 8601). */
  exportedAt: string;
  players: Player[];
  games: Game[];
  events: StatEvent[];
  settings?: Settings;
}

/** A backup file that can't be restored. `message` is written for the parent to read. */
export class ExportFileError extends Error {
  /** Technical specifics for logs, e.g. 'games[3].date: Expected a date like 2026-09-27'. */
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ExportFileError';
    this.details = details;
  }
}

const NOT_A_BACKUP = "This file isn't a Hoop Stats backup.";
const NEWER_VERSION =
  'This backup is from a newer version of Hoop Stats. Update the app, then try again.';
const DAMAGED = "This backup is damaged, so it can't be restored.";

const exportFileSchema = z.object({
  app: z.literal(EXPORT_APP),
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string().check(
    z.maxLength(64),
    z.refine((value) => !Number.isNaN(Date.parse(value)), 'Expected a date and time'),
  ),
  players: z.array(playerSchema),
  games: z.array(gameSchema),
  events: z.array(statEventSchema),
  settings: z.optional(settingsSchema),
});

/** Everything on the device, read in one transaction so it's a consistent snapshot. */
export function exportAll(): Promise<ExportFile> {
  return db.transaction('r', [db.players, db.games, db.events, db.meta], async () => {
    const [players, games, events, settings] = await Promise.all([
      db.players.toArray(),
      db.games.toArray(),
      db.events.orderBy('[gameId+createdAt]').toArray(),
      getSettings(),
    ]);
    players.sort((a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id));
    games.sort(
      (a, b) => compareIds(a.date, b.date) || a.createdAt - b.createdAt || compareIds(a.id, b.id),
    );
    return {
      app: EXPORT_APP,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      players,
      games,
      events,
      settings,
    };
  });
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Duplicate ids and references to players or games that aren't in the file. */
function integrityProblems(file: ExportFile): string[] {
  const problems: string[] = [];
  const idsOf = (name: string, records: readonly { id: string }[]) => {
    const ids = new Set<string>();
    records.forEach((record, index) => {
      if (ids.has(record.id)) problems.push(`${name}[${index}].id: Duplicate id ${record.id}`);
      ids.add(record.id);
    });
    return ids;
  };
  const playerIds = idsOf('players', file.players);
  const gameIds = idsOf('games', file.games);
  idsOf('events', file.events);

  file.games.forEach((game, index) => {
    if (!playerIds.has(game.playerId)) {
      problems.push(`games[${index}].playerId: No player with id ${game.playerId}`);
    }
  });
  file.events.forEach((event, index) => {
    if (!gameIds.has(event.gameId)) {
      problems.push(`events[${index}].gameId: No game with id ${event.gameId}`);
    }
  });
  return problems;
}

/**
 * Checks that `input` is a Hoop Stats backup this version can restore, and returns
 * a clean copy. Accepts the parsed object or the JSON text. Throws ExportFileError
 * with a message for the parent ("This file isn't a Hoop Stats backup.", …).
 */
export function parseExportFile(input: unknown): ExportFile {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      throw new ExportFileError(NOT_A_BACKUP, ['Not JSON']);
    }
  }
  if (!isRecord(data) || data.app !== EXPORT_APP) {
    throw new ExportFileError(NOT_A_BACKUP, ['app: Expected "hoop-stats"']);
  }

  const version = data.schemaVersion;
  if (typeof version === 'number' && version > EXPORT_SCHEMA_VERSION) {
    throw new ExportFileError(NEWER_VERSION, [`schemaVersion: ${version}`]);
  }
  // Older versions would be upgraded here, once there are any.

  const result = exportFileSchema.safeParse(data);
  if (!result.success) {
    throw new ExportFileError(DAMAGED, result.error.issues.slice(0, 20).map(describeIssue));
  }
  const file: ExportFile = {
    ...result.data,
    players: result.data.players.map(withoutUndefined),
    games: result.data.games.map(withoutUndefined),
    events: result.data.events.map(withoutUndefined),
  };
  if (result.data.settings) file.settings = withoutUndefined(result.data.settings);
  else delete file.settings;

  const problems = integrityProblems(file);
  if (problems.length > 0) throw new ExportFileError(DAMAGED, problems.slice(0, 20));
  return file;
}

export type ImportMode = 'replace' | 'merge';

export interface ImportSummary {
  /** Games written from the file (all of them for 'replace'). */
  games: number;
  /** Stat events written from the file. */
  events: number;
}

/** The player to keep when merging: details from whichever was set up most recently. */
function mergePlayers(local: Player, incoming: Player): Player {
  const [newer, older] =
    incoming.updatedAt > local.updatedAt ? [incoming, local] : [local, incoming];
  // A player that was never named (e.g. created by a first game on a new phone)
  // doesn't overwrite a named one.
  const source = newer.name.trim() || !older.name.trim() ? newer : older;
  return withoutUndefined({
    id: local.id,
    name: source.name,
    jerseyNumber: source.jerseyNumber,
    createdAt: Math.min(local.createdAt, incoming.createdAt),
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
  });
}

async function replaceAll(file: ExportFile): Promise<ImportSummary> {
  await Promise.all([db.players.clear(), db.games.clear(), db.events.clear()]);
  await db.players.bulkAdd(file.players);
  await db.games.bulkAdd(file.games);
  await db.events.bulkAdd(file.events);
  if (file.settings) await db.meta.put({ key: META_KEYS.settings, value: file.settings });
  return { games: file.games.length, events: file.events.length };
}

async function mergeAll(file: ExportFile): Promise<ImportSummary> {
  // One player: the file's player and this device's player are the same person.
  const localPlayer = primaryPlayer(await db.players.toArray());
  const filePlayer = primaryPlayer(file.players);
  let playerId: string | undefined;
  if (filePlayer) {
    const player = localPlayer ? mergePlayers(localPlayer, filePlayer) : filePlayer;
    await db.players.put(player);
    playerId = player.id;
  }

  // Games: the copy updated most recently wins.
  const localGames = await db.games.bulkGet(file.games.map((game) => game.id));
  const games = file.games
    .filter((game, index) => {
      const local = localGames[index];
      return !local || game.updatedAt > local.updatedAt;
    })
    .map((game) => (playerId ? { ...game, playerId } : game));
  await db.games.bulkPut(games);

  // Events: add the ones this device doesn't have, and keep its copy of the others.
  const localEvents = await db.events.bulkGet(file.events.map((event) => event.id));
  const events = file.events.filter((_, index) => !localEvents[index]);
  await db.events.bulkAdd(events);

  // Settings are this device's preferences: only fill them in if there are none.
  if (file.settings && !(await db.meta.get(META_KEYS.settings))) {
    await db.meta.put({ key: META_KEYS.settings, value: file.settings });
  }
  return { games: games.length, events: events.length };
}

/**
 * Restores a backup in one transaction: if anything fails, nothing changes.
 * - 'replace': the device ends up with exactly the file's data (its settings too,
 *   if the file has them).
 * - 'merge': adds the file's data to the device's. For games (and the player) the
 *   copy updated most recently wins; events are added by id; nothing is deleted.
 *   Merge keeps one player, with the most recently set-up name and number.
 * The file is validated again first, so passing an unchecked object is safe.
 */
export async function importAll(file: ExportFile, mode: ImportMode): Promise<ImportSummary> {
  if (mode !== 'replace' && mode !== 'merge') {
    throw new TypeError(`Unknown import mode: ${String(mode)}`);
  }
  const valid = parseExportFile(file);
  const summary = await db.transaction(
    'rw',
    [db.players, db.games, db.events, db.meta],
    async () => {
      const result = mode === 'replace' ? await replaceAll(valid) : await mergeAll(valid);
      await touchLastChange(Date.now());
      return result;
    },
  );
  return summary;
}

/**
 * Deletes the player, every game and stat, and the settings. Other device-local
 * records in `meta` (such as the backup's own state) are kept.
 */
export function clearAllData(): Promise<void> {
  return db.transaction('rw', [db.players, db.games, db.events, db.meta], async () => {
    await Promise.all([
      db.players.clear(),
      db.games.clear(),
      db.events.clear(),
      db.meta.delete(META_KEYS.settings),
    ]);
    await touchLastChange(Date.now());
  });
}
