/**
 * Realistic demo data for screenshots, e2e tests and trying the app out: a season of
 * final games for one player, generated with a seeded random number generator so the
 * stats are the same every time. Dates count back from today (or `options.today`).
 */
import {
  BASELINE_Y,
  isOnHalfCourt,
  isThreePoint,
  THREE_POINT_CORNER_X,
  THREE_POINT_RADIUS,
} from '@/lib/court';
import { parseLocalDate, todayLocalISO, toLocalISODate } from '@/lib/format';
import { db } from './db';
import { deleteGame, getPlayer, listGames, savePlayer } from './repo';
import { isFieldGoalType } from './stats';
import { EXPORT_APP, EXPORT_SCHEMA_VERSION, importAll, type ExportFile } from './transfer';
import type { CourtPoint, Game, HomeAway, Player, StatEvent, StatType } from './types';

export const DEMO_PLAYER_ID = 'demo-player';
const DEMO_PLAYER_NAME = 'Ava';
const DEMO_PLAYER_NUMBER = '12';
export const DEMO_SEASON = 'Fall 2026';
/** The optional live game's id (see `DemoOptions.liveGame`). */
export const DEMO_LIVE_GAME_ID = 'demo-live';

/** Id of the nth demo game, 1 (oldest) to 10 (newest), e.g. 'demo-game-10'. */
export function demoGameId(n: number): string {
  return `demo-game-${String(n).padStart(2, '0')}`;
}

/** Whether a game is demo data (e.g. to remove the sample games and nothing else). */
export function isDemoGameId(id: string): boolean {
  return id === DEMO_LIVE_GAME_ID || /^demo-game-\d{2}$/.test(id);
}

export interface DemoOptions {
  /** The local date ('YYYY-MM-DD') the games count back from. Defaults to today. */
  today?: string;
  /** Also add a live game today, in the third quarter (for the live game screen). */
  liveGame?: boolean;
  /**
   * seedDemoData only: replace the device's own data too. Without it, seeding refuses
   * if there's any player or game that isn't demo data.
   */
  force?: boolean;
  /** seedDemoData only: keep this device's settings instead of the demo's. */
  keepSettings?: boolean;
  /**
   * seedDemoData only: keep a player the parent set up (with a name or a number), and
   * make the sample games hers instead of the sample player's. A player with neither is
   * replaced by the sample player, as without it. Players never count as the device's
   * own data then: only its games do.
   */
  keepPlayer?: boolean;
}

interface DemoGamePlan {
  daysAgo: number;
  opponent: string;
  homeAway: HomeAway;
  result: 'W' | 'L';
  notes?: string;
}

/** Oldest first. A 7-3 record. */
const SCHEDULE: readonly DemoGamePlan[] = [
  { daysAgo: 58, opponent: 'Lincoln', homeAway: 'home', result: 'W' },
  { daysAgo: 53, opponent: 'Roosevelt', homeAway: 'away', result: 'W' },
  { daysAgo: 47, opponent: 'Central Catholic', homeAway: 'home', result: 'L' },
  { daysAgo: 42, opponent: 'Westview', homeAway: 'away', result: 'W' },
  {
    daysAgo: 36,
    opponent: 'Oak Ridge',
    homeAway: 'neutral',
    result: 'W',
    notes: 'Holiday tournament, first round.',
  },
  { daysAgo: 31, opponent: "St. Mary's", homeAway: 'home', result: 'L' },
  { daysAgo: 24, opponent: 'Jefferson', homeAway: 'away', result: 'W' },
  {
    daysAgo: 17,
    opponent: 'Northside',
    homeAway: 'home',
    result: 'W',
    notes: 'Great defensive effort. Coach loved the hustle.',
  },
  { daysAgo: 10, opponent: 'Riverside', homeAway: 'away', result: 'L' },
  { daysAgo: 4, opponent: 'Eastlake', homeAway: 'home', result: 'W' },
];

const MINUTE = 60_000;
/** Real minutes from tip-off to the start of each quarter (halftime after Q2). */
const QUARTER_STARTS = [0, 17, 44, 61] as const;
/** Real minutes each quarter lasts. */
const QUARTER_LENGTH = 15;

/** mulberry32: a tiny, fast, seeded PRNG. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    between: (min: number, max: number): number => min + next() * (max - min),
    chance: (probability: number): boolean => next() < probability,
    /** Successes in `trials` tries at `probability` each. */
    binomial: (trials: number, probability: number): number => {
      let successes = 0;
      for (let i = 0; i < trials; i++) if (next() < probability) successes++;
      return successes;
    },
    pick: <T>(items: readonly [T, ...T[]]): T => items[int(0, items.length - 1)] ?? items[0],
  };
}
type Random = ReturnType<typeof createRandom>;

/** Tenths of a foot, and never -0 (JSON can't keep it). */
function roundFt(value: number): number {
  return Math.round(value * 10) / 10 || 0;
}

function point(x: number, y: number): CourtPoint {
  return { x: roundFt(x), y: roundFt(y) };
}

/** A two: mostly close to the basket, some midrange, a few baseline jumpers. */
function twoPointSpot(random: Random): CourtPoint {
  for (;;) {
    const distance = random.chance(0.5) ? random.between(0.5, 5) : random.between(5, 18.5);
    const angle = random.between(-0.08, 1.08) * Math.PI;
    const spot = point(distance * Math.cos(angle), distance * Math.sin(angle));
    if (spot.y >= BASELINE_Y + 0.5 && isOnHalfCourt(spot) && !isThreePoint(spot)) return spot;
  }
}

/** A three: from the corners or around the arc. */
function threePointSpot(random: Random): CourtPoint {
  for (;;) {
    let spot: CourtPoint;
    if (random.chance(0.25)) {
      const side = random.chance(0.5) ? 1 : -1;
      spot = point(
        side * random.between(THREE_POINT_CORNER_X + 0.4, 24.5),
        random.between(-4.5, 1),
      );
    } else {
      const distance = random.between(THREE_POINT_RADIUS + 0.4, THREE_POINT_RADIUS + 4);
      const angle = random.between(0.1, 0.9) * Math.PI;
      spot = point(distance * Math.cos(angle), distance * Math.sin(angle));
    }
    if (isOnHalfCourt(spot) && isThreePoint(spot)) return spot;
  }
}

interface BoxPlan {
  fg2m: number;
  fg2a: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  counts: Partial<Record<StatType, number>>;
}

/** One game's numbers, typical of a solid high-school guard: 6-18 points. */
function planBox(random: Random): BoxPlan {
  for (;;) {
    const fg2a = random.int(4, 11);
    const fg2m = random.binomial(fg2a, 0.46);
    const fg3a = random.int(0, 5);
    const fg3m = random.binomial(fg3a, 0.3);
    const fta = random.pick([0, 0, 2, 2, 2, 3, 4, 4, 5, 6]);
    const ftm = random.binomial(fta, 0.68);
    const points = 2 * fg2m + 3 * fg3m + ftm;
    if (points < 6 || points > 18) continue;
    return {
      fg2m,
      fg2a,
      fg3m,
      fg3a,
      ftm,
      fta,
      counts: {
        oreb: random.int(0, 3),
        dreb: random.int(2, 6),
        ast: random.int(0, 5),
        stl: random.int(0, 4),
        blk: random.int(0, 2),
        tov: random.int(0, 4),
        foul: random.int(0, 4),
        deflection: random.int(0, 5),
        charge: random.chance(0.35) ? random.int(1, 2) : 0,
      },
    };
  }
}

function shuffle<T>(items: T[], random: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = random.int(0, i);
    [items[i], items[j]] = [items[j] as T, items[i] as T];
  }
  return items;
}

function repeat<T>(item: T, times: number): T[] {
  return Array.from({ length: times }, () => item);
}

/** One or more taps that happen together, e.g. a trip to the free-throw line. */
interface Moment {
  period: number;
  at: number;
  types: StatType[];
}

/** Stat events for one game, spread over `periods` quarters from `tipOff`. */
function gameEvents(
  gameId: string,
  box: BoxPlan,
  tipOff: number,
  periods: number,
  random: Random,
): StatEvent[] {
  const at = (period: number) => {
    const quarterStart = QUARTER_STARTS[(period - 1) % QUARTER_STARTS.length] ?? 0;
    return tipOff + (quarterStart + random.between(0, QUARTER_LENGTH)) * MINUTE;
  };
  const moment = (types: StatType[]): Moment => {
    const period = random.int(1, periods);
    return { period, at: at(period), types };
  };

  const moments: Moment[] = [];
  const single: StatType[] = [
    ...repeat<StatType>('fg2_made', box.fg2m),
    ...repeat<StatType>('fg2_miss', box.fg2a - box.fg2m),
    ...repeat<StatType>('fg3_made', box.fg3m),
    ...repeat<StatType>('fg3_miss', box.fg3a - box.fg3m),
  ];
  for (const [type, count] of Object.entries(box.counts) as [StatType, number][]) {
    single.push(...repeat(type, count));
  }
  for (const type of single) moments.push(moment([type]));

  // Free throws come in trips of two (one for an odd attempt), made or missed at random.
  const freeThrows = shuffle(
    [...repeat<StatType>('ft_made', box.ftm), ...repeat<StatType>('ft_miss', box.fta - box.ftm)],
    random,
  );
  for (let i = 0; i < freeThrows.length; i += 2) moments.push(moment(freeThrows.slice(i, i + 2)));

  moments.sort((a, b) => a.at - b.at);
  const events: StatEvent[] = [];
  let last = 0;
  for (const { period, at: time, types } of moments) {
    types.forEach((type, index) => {
      const createdAt = Math.max(Math.round(time) + index * 20_000, last + 1);
      last = createdAt;
      const event: StatEvent = {
        id: `${gameId}-${String(events.length + 1).padStart(3, '0')}`,
        gameId,
        type,
        period,
        createdAt,
      };
      if (isFieldGoalType(type) && random.chance(0.85)) {
        event.location =
          type === 'fg3_made' || type === 'fg3_miss'
            ? threePointSpot(random)
            : twoPointSpot(random);
      }
      events.push(event);
    });
  }
  return events;
}

function pointsOf(box: BoxPlan): number {
  return 2 * box.fg2m + 3 * box.fg3m + box.ftm;
}

/** Local time on `isoDate` at hour:minute, as epoch ms. */
function localTime(isoDate: string, hour: number, minute = 0): number {
  const date = parseLocalDate(isoDate);
  if (!date) throw new RangeError(`Invalid date: ${isoDate}`);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function daysBefore(isoDate: string, days: number): string {
  const date = parseLocalDate(isoDate);
  if (!date) throw new RangeError(`Invalid date: ${isoDate}`);
  date.setDate(date.getDate() - days);
  return toLocalISODate(date);
}

/** The demo data as an export file (nothing is written). Same options, same data. */
export function buildDemoData(options: DemoOptions = {}): ExportFile {
  const today = options.today ?? todayLocalISO();
  const random = createRandom(20_260_927);

  const firstDate = daysBefore(today, SCHEDULE[0]?.daysAgo ?? 0);
  const playerCreatedAt = localTime(daysBefore(firstDate, 7), 20);
  const player: Player = {
    id: DEMO_PLAYER_ID,
    name: DEMO_PLAYER_NAME,
    jerseyNumber: DEMO_PLAYER_NUMBER,
    createdAt: playerCreatedAt,
    updatedAt: playerCreatedAt,
  };

  const games: Game[] = [];
  const events: StatEvent[] = [];
  SCHEDULE.forEach((plan, index) => {
    const id = demoGameId(index + 1);
    const date = daysBefore(today, plan.daysAgo);
    const tipOff = localTime(date, 18);
    const box = planBox(random);

    const teamScore = Math.max(random.int(36, 58), pointsOf(box) + 16);
    const margin = plan.result === 'W' ? -random.int(3, 15) : random.int(2, 11);
    const endedAt = tipOff + 80 * MINUTE;
    const game: Game = {
      id,
      playerId: player.id,
      opponent: plan.opponent,
      date,
      season: DEMO_SEASON,
      homeAway: plan.homeAway,
      periodFormat: 'quarters',
      currentPeriod: 4,
      status: 'final',
      teamScore,
      opponentScore: teamScore + margin,
      createdAt: tipOff - 20 * MINUTE,
      updatedAt: endedAt,
      endedAt,
    };
    if (plan.notes) game.notes = plan.notes;
    games.push(game);
    events.push(...gameEvents(id, box, tipOff, 4, random));
  });

  if (options.liveGame) {
    const tipOff = localTime(today, 17);
    const liveEvents = gameEvents(DEMO_LIVE_GAME_ID, planBox(random), tipOff, 3, random);
    games.push({
      id: DEMO_LIVE_GAME_ID,
      playerId: player.id,
      opponent: 'Westfield',
      date: today,
      season: DEMO_SEASON,
      homeAway: 'home',
      periodFormat: 'quarters',
      currentPeriod: 3,
      status: 'live',
      createdAt: tipOff - 20 * MINUTE,
      updatedAt: liveEvents.at(-1)?.createdAt ?? tipOff,
    });
    events.push(...liveEvents);
  }

  const lastChange = Math.max(...games.map((game) => game.updatedAt));
  return {
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date(lastChange).toISOString(),
    players: [player],
    games,
    events,
    settings: { shotChart: true, defaultPeriodFormat: 'quarters', lastSeason: DEMO_SEASON },
  };
}

/** Whether the device holds a game (or, unless `keepPlayer`, a player) that isn't demo data. */
async function hasOwnData({ keepPlayer = false }: DemoOptions = {}): Promise<boolean> {
  const gameIds = await db.games.toCollection().primaryKeys();
  if (gameIds.some((id) => !isDemoGameId(id))) return true;
  if (keepPlayer) return false;
  const playerIds = await db.players.toCollection().primaryKeys();
  return playerIds.some((id) => id !== DEMO_PLAYER_ID);
}

/** The device's player, if the parent set her up: she has a name or a number. */
async function setUpPlayer(): Promise<Player | undefined> {
  const player = await getPlayer();
  return player && (player.name.trim() || player.jerseyNumber) ? player : undefined;
}

/**
 * Replaces everything on this device with the demo data: player "Ava" #12 and ten
 * final "Fall 2026" games (ids `demoGameId(1)`…`demoGameId(10)`, newest last), or the
 * games alone, for a player the parent set up, with `keepPlayer`. It's on
 * `window.hoopStats` in every build, so it refuses to touch real data (anything but
 * earlier demo data) unless called with `{ force: true }`.
 */
export async function seedDemoData(options: DemoOptions = {}): Promise<void> {
  if (!options.force && (await hasOwnData(options))) {
    throw new Error(
      'This device has its own data, so the demo data was not loaded. ' +
        'Use seedDemoData({ force: true }) to replace it.',
    );
  }
  const { settings, ...demo } = buildDemoData(options);
  const player = options.keepPlayer ? await setUpPlayer() : undefined;
  const games = player ? demo.games.map((game) => ({ ...game, playerId: player.id })) : demo.games;
  const data = player ? { ...demo, players: [player], games } : demo;
  // A backup without settings leaves the device's own settings alone.
  await importAll(options.keepSettings ? data : { ...data, settings }, 'replace');
}

/**
 * "Try it with sample data": the sample games, keeping this phone's settings and a
 * player the parent set up (the games are hers then; otherwise they come with the
 * sample player, "Ava" #12). Resolves to false, adding nothing, when the phone has
 * games of its own.
 */
export async function addSampleData(): Promise<boolean> {
  if (await hasOwnData({ keepPlayer: true })) return false;
  await seedDemoData({ keepPlayer: true, keepSettings: true });
  return true;
}

/** Whether `player` is the sample player just as the sample data made her: not renamed. */
export function isDemoPlayer(player: Pick<Player, 'id' | 'name' | 'jerseyNumber'>): boolean {
  return (
    player.id === DEMO_PLAYER_ID &&
    player.name === DEMO_PLAYER_NAME &&
    player.jerseyNumber === DEMO_PLAYER_NUMBER
  );
}

/**
 * "Remove sample games": deletes the sample games and their stats and, while the player
 * is still the sample player (isDemoPlayer), her name and number. Her record stays, so
 * games of the parent's own stay attached to it, and the app asks who's being tracked
 * again. A player the parent named or renamed, her games and the settings stay as they
 * are. All in one transaction: all or nothing. Resolves to how many games it removed.
 */
export function removeDemoData(): Promise<number> {
  return db.transaction('rw', [db.players, db.games, db.events, db.meta], async () => {
    const sampleIds = (await listGames()).map((game) => game.id).filter(isDemoGameId);
    for (const id of sampleIds) await deleteGame(id);
    const player = await getPlayer();
    if (player && isDemoPlayer(player)) await savePlayer({ name: '', jerseyNumber: null });
    return sampleIds.length;
  });
}
