/**
 * Shots for the shot chart: 2PT and 3PT attempts taken from stat events, and
 * shooting by zone. Pure functions only: no database, no React.
 *
 * Zones agree with the box score: a shot recorded as a 3PT attempt counts as a
 * three wherever it was tapped, and a 2PT attempt counts in the paint or mid-range
 * by where it was taken from.
 */
import { isInPaint, type ShotZone } from '@/lib/court';
import { isFieldGoalType, STAT_DEFS } from './stats';
import type { CourtPoint, StatEvent } from './types';

/** One 2PT or 3PT attempt. */
export interface Shot {
  made: boolean;
  /** What it was worth, as recorded (the 2PT or 3PT button), not where it was tapped. */
  points: 2 | 3;
  /** Where it was taken from, when the spot was recorded. */
  location?: CourtPoint;
}

/** A shot whose spot was recorded, so it can go on a shot map. */
export type LocatedShot = Shot & { location: CourtPoint };

/**
 * Every 2PT and 3PT attempt in a list of stat events (one game's, or a season's), in
 * event order, with its location when it has one. Free throws and other stats are
 * left out.
 */
export function shotsFromEvents(events: readonly Pick<StatEvent, 'type' | 'location'>[]): Shot[] {
  const shots: Shot[] = [];
  for (const { type, location } of events) {
    if (!isFieldGoalType(type)) continue;
    const def = STAT_DEFS[type];
    const shot: Shot = { made: def.kind === 'made', points: def.shot === 'fg3' ? 3 : 2 };
    if (location) shot.location = location;
    shots.push(shot);
  }
  return shots;
}

export function hasLocation(shot: Shot): shot is LocatedShot {
  return shot.location !== undefined;
}

/** The zones in display order: closest to the basket first. */
export const SHOT_ZONES = ['paint', 'midrange', 'three'] as const satisfies readonly ShotZone[];

/**
 * The zone a shot counts in: 'three' for every 3PT attempt; the paint or mid-range for
 * a 2PT attempt, by its location. null for a 2PT attempt with no location.
 */
export function shotZoneOf(shot: Shot): ShotZone | null {
  if (shot.points === 3) return 'three';
  if (!shot.location) return null;
  return isInPaint(shot.location) ? 'paint' : 'midrange';
}

export interface MadeAttempted {
  made: number;
  attempted: number;
}

/**
 * Makes and attempts in each zone (see `shotZoneOf`). Every 3PT attempt counts, so
 * 'three' matches the box score; 2PT attempts count only when they have a location.
 */
export function shotsByZone(shots: readonly Shot[]): Record<ShotZone, MadeAttempted> {
  const zones: Record<ShotZone, MadeAttempted> = {
    paint: { made: 0, attempted: 0 },
    midrange: { made: 0, attempted: 0 },
    three: { made: 0, attempted: 0 },
  };
  for (const shot of shots) {
    const zone = shotZoneOf(shot);
    if (!zone) continue;
    zones[zone].attempted += 1;
    if (shot.made) zones[zone].made += 1;
  }
  return zones;
}

/** Makes and attempts over all the shots. */
export function countShots(shots: readonly Shot[]): MadeAttempted {
  let made = 0;
  for (const shot of shots) if (shot.made) made += 1;
  return { made, attempted: shots.length };
}

/**
 * What a report's "Shot chart" section shows for its shots (one game's, or the games on
 * the Stats tab), given the Shot chart setting (whether the live game screen asks where
 * each shot was taken):
 *
 * - 'map': a shot map and shooting by zone, once any shot has a spot.
 * - 'noSpots': a note that no spots were recorded, while the setting asks for them.
 * - null: no section at all. There are no 2PT/3PT attempts, or none has a spot and the
 *   setting is off: a family that doesn't record spots wants no empty courts.
 */
export function shotChartSection(
  shots: readonly Shot[],
  askForSpots: boolean,
): 'map' | 'noSpots' | null {
  if (shots.some(hasLocation)) return 'map';
  return shots.length > 0 && askForSpots ? 'noSpots' : null;
}
