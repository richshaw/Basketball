/**
 * Export and import of all data as one JSON-friendly object. Shared by the file
 * backup and the encrypted cloud backup, so a round trip must be exact:
 * `importAll(parseExportFile(JSON.parse(JSON.stringify(await exportAll()))), 'replace')`
 * restores exactly what was exported.
 */
import * as z from 'zod/mini';
import { compareIds } from '@/lib/id';
import { db, META_KEYS, touchLastChange } from './db';
import { isDemoGameId, isDemoPlayer } from './demoIds';
import { forgetPendingStats } from './pendingStats';
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
/**
 * The backup format version. Bump it for ANY change to what a record can hold: a new
 * field, a new allowed value (such as a stat type) or a looser limit. An older app
 * then says "update the app" instead of silently dropping the new data (it strips
 * fields it doesn't know) or calling a good backup damaged. When you bump it, teach
 * parseExportFile to read the older versions.
 */
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

/** The ExportFileError message for a file that isn't a Hoop Stats backup at all. */
export const NOT_A_BACKUP = "This file isn't a Hoop Stats backup.";
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

/** How every backup's text starts (its `app` comes first), however it ends. */
const EXPORT_START = /^\uFEFF?\s*\{\s*"app"\s*:\s*"hoop-stats"/;

/**
 * Checks that `input` is a Hoop Stats backup this version can restore, and returns
 * a clean copy. Accepts the parsed object or the JSON text. Throws ExportFileError
 * with a message for the parent ("This file isn't a Hoop Stats backup.", …). Text
 * that can't be read at all is a damaged backup, not some other file, when it starts
 * like one (cut off, say) or `ours` says it's one of ours (e.g. by the file's name).
 */
export function parseExportFile(input: unknown, { ours = false } = {}): ExportFile {
  let data = input;
  if (typeof data === 'string') {
    const text = data;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      const damaged = ours || EXPORT_START.test(text);
      throw new ExportFileError(damaged ? DAMAGED : NOT_A_BACKUP, ['Not JSON']);
    }
  }
  if (!isRecord(data) || data.app !== EXPORT_APP) {
    throw new ExportFileError(NOT_A_BACKUP, ['app: Expected "hoop-stats"']);
  }

  // Before checking the contents: a newer file may hold fields or values this version
  // doesn't know, and must get "update the app", never "damaged".
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
  /** Games taken from the file: all of them for 'replace'; the new or newer ones for 'merge'. */
  games: number;
  /** Stat events taken from the file along with those games. */
  events: number;
  /**
   * 'merge' only, and only when it removed any: the sample games it removed from the
   * phone, since the file holds games of her own (see sampleGamesToRemove).
   */
  sampleGamesRemoved?: number;
}

/**
 * The sample games (by id, from `phoneGameIds`) that adding `file` to this phone
 * removes, so they can never count in her stats alongside her own games: when the file
 * holds a game of her own (any game that isn't a sample game, isDemoGameId), every
 * sample game on the phone that the file doesn't have too. None when the file holds
 * only sample games: adding it then works as it always has. (Sample games in the file
 * were in her backup, so they stay, merged like any other game.)
 */
export function sampleGamesToRemove(
  phoneGameIds: readonly string[],
  file: Pick<ExportFile, 'games'>,
): string[] {
  const fileGameIds = new Set(file.games.map((game) => game.id));
  if (![...fileGameIds].some((id) => !isDemoGameId(id))) return [];
  return phoneGameIds.filter((id) => isDemoGameId(id) && !fileGameIds.has(id));
}

/** What an import did, and whether the device's data actually changed. */
interface ImportOutcome {
  summary: ImportSummary;
  changed: boolean;
}

/** A record as JSON with its keys sorted, to tell whether two copies hold the same data. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => compareIds(a, b)))
      : inner,
  );
}

/** Whether two lists hold the same records, in any order. */
function sameRecords(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((record) => [record.id, canonical(record)]));
  return b.every((record) => byId.get(record.id) === canonical(record));
}

/** Whether the device already holds exactly the file's data (and its settings, if any). */
async function deviceMatches(file: ExportFile): Promise<boolean> {
  const [players, games, events, settings] = await Promise.all([
    db.players.toArray(),
    db.games.toArray(),
    db.events.toArray(),
    getSettings(),
  ]);
  return (
    sameRecords(players, file.players) &&
    sameRecords(games, file.games) &&
    sameRecords(events, file.events) &&
    (!file.settings || canonical(settings) === canonical(file.settings))
  );
}

/**
 * The player to keep when merging: details from whichever was set up most recently.
 * The sample player, as the sample data made her (isDemoPlayer), never wins: the other
 * player is kept as it is, dates and all, so trying the sample games first can't
 * rename the parent's own player, however long ago she set her up.
 */
function mergePlayers(local: Player, incoming: Player): Player {
  if (isDemoPlayer(incoming)) return local;
  // Under this phone's id, which its games (the sample games, say) have.
  if (isDemoPlayer(local)) return { ...incoming, id: local.id };
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

async function replaceAll(file: ExportFile): Promise<ImportOutcome> {
  const summary = { games: file.games.length, events: file.events.length };
  // Restoring exactly what the device already holds changes nothing.
  if (await deviceMatches(file)) return { summary, changed: false };

  await Promise.all([db.players.clear(), db.games.clear(), db.events.clear()]);
  await db.players.bulkAdd(file.players);
  await db.games.bulkAdd(file.games);
  await db.events.bulkAdd(file.events);
  if (file.settings) await db.meta.put({ key: META_KEYS.settings, value: file.settings });
  return { summary, changed: true };
}

/**
 * `sampleIds`: the sample games to remove first (see sampleGamesToRemove), with their
 * stats, so they never count alongside the games of her own coming in.
 */
async function mergeAll(file: ExportFile, sampleIds: string[]): Promise<ImportOutcome> {
  let changed = false;

  let sampleGamesRemoved = 0;
  if (sampleIds.length > 0) {
    sampleGamesRemoved = (await db.games.bulkGet(sampleIds)).filter(Boolean).length;
    const sampleEvents = await db.events.where('gameId').anyOf(sampleIds).delete();
    await db.games.bulkDelete(sampleIds);
    if (sampleGamesRemoved > 0 || sampleEvents > 0) changed = true;
  }

  // One player: the file's player and this device's player are the same person.
  const localPlayer = primaryPlayer(await db.players.toArray());
  const filePlayer = primaryPlayer(file.players);
  let playerId: string | undefined;
  if (filePlayer) {
    const player = localPlayer ? mergePlayers(localPlayer, filePlayer) : filePlayer;
    if (!localPlayer || canonical(player) !== canonical(localPlayer)) {
      await db.players.put(player);
      changed = true;
    }
    playerId = player.id;
  }

  // A game and its events are one unit: the copy updated most recently wins whole.
  // A newer copy in the file replaces the game and all of its events, so stats
  // deleted or moved there come across too. An older copy (or one just as old) is
  // skipped with its events, so stats undone on the device stay undone.
  const localGames = await db.games.bulkGet(file.games.map((game) => game.id));
  const newer = file.games.filter((game, index) => {
    const local = localGames[index];
    return !local || game.updatedAt > local.updatedAt;
  });
  const newerIds = new Set(newer.map((game) => game.id));
  const events = file.events.filter((event) => newerIds.has(event.gameId));
  if (newer.length > 0) {
    await db.events
      .where('gameId')
      .anyOf([...newerIds])
      .delete();
    await db.games.bulkPut(newer.map((game) => (playerId ? { ...game, playerId } : game)));
    await db.events.bulkPut(events);
    changed = true;
  }

  // Settings are this device's preferences: only fill them in if there are none.
  if (file.settings && !(await db.meta.get(META_KEYS.settings))) {
    if (canonical(await getSettings()) !== canonical(file.settings)) changed = true;
    await db.meta.put({ key: META_KEYS.settings, value: file.settings });
  }
  const summary: ImportSummary = { games: newer.length, events: events.length };
  if (sampleGamesRemoved > 0) summary.sampleGamesRemoved = sampleGamesRemoved;
  return { summary, changed };
}

/**
 * Restores a backup in one transaction: if anything fails, nothing changes.
 * - 'replace': the device ends up with exactly the file's data (its settings too,
 *   if the file has them). Taps not saved yet are forgotten (see forgetPendingStats),
 *   so none of the data it replaces can come back into a restored game.
 * - 'merge': combines the file with the device's data. A game and its events are one
 *   unit, and whichever copy was updated most recently wins whole: a newer copy in
 *   the file replaces that game's events too, an older one is skipped (so stats
 *   undone on the device stay undone). Games on only one side are kept, so a merge
 *   brings back games deleted on the device, except the sample games: a file with
 *   games of her own removes them from the phone (see sampleGamesToRemove), with their
 *   taps and spots not saved yet (as removeDemoData does). One player is kept, with the
 *   most recently set-up name and number, and the device keeps its own settings.
 * `meta.lastChangeAt` only moves if the import changed something.
 * The file is validated again first, so passing an unchecked object is safe.
 */
export async function importAll(file: ExportFile, mode: ImportMode): Promise<ImportSummary> {
  if (mode !== 'replace' && mode !== 'merge') {
    throw new TypeError(`Unknown import mode: ${String(mode)}`);
  }
  const valid = parseExportFile(file);
  const sampleIds =
    mode === 'merge' ? sampleGamesToRemove(await db.games.toCollection().primaryKeys(), valid) : [];
  // Right before the write: then no retry can save a tap into the data replacing it, or
  // into a sample game it removes (added again later, it would have the same id).
  const keepAgain =
    mode === 'replace' ? [forgetPendingStats()] : sampleIds.map((id) => forgetPendingStats(id));
  try {
    return await db.transaction('rw', [db.players, db.games, db.events, db.meta], async () => {
      const outcome =
        mode === 'replace' ? await replaceAll(valid) : await mergeAll(valid, sampleIds);
      // An import that changes nothing mustn't look like a change (the backup would
      // upload again after every merge).
      if (outcome.changed) await touchLastChange(Date.now());
      return outcome.summary;
    });
  } catch (error) {
    for (const again of keepAgain) again();
    throw error;
  }
}

/**
 * Deletes the player, every game and stat, and the settings, and forgets every tap not
 * saved yet (see forgetPendingStats), so nothing of the erased games is left on the
 * phone, and none of their taps can come back into a new game with the same id (sample
 * games always have the same ids). Other device-local records in `meta` (such as the
 * backup's own state) are kept.
 */
export function clearAllData(): Promise<void> {
  // Right before the write: then no retry can save a tap once the data is gone.
  const keepAgain = forgetPendingStats();
  return db
    .transaction('rw', [db.players, db.games, db.events, db.meta], async () => {
      const [players, games, events, settings] = await Promise.all([
        db.players.count(),
        db.games.count(),
        db.events.count(),
        db.meta.get(META_KEYS.settings),
      ]);
      if (players + games + events === 0 && settings === undefined) return;
      await Promise.all([
        db.players.clear(),
        db.games.clear(),
        db.events.clear(),
        db.meta.delete(META_KEYS.settings),
      ]);
      await touchLastChange(Date.now());
    })
    .catch((error: unknown) => {
      keepAgain();
      throw error;
    });
}
