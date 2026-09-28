/**
 * Shots for the shot chart: turning stat events into shots, and shooting by zone.
 * Pure functions only: no React, no DOM.
 */
import { percentage } from '@/data/stats';
import type { CourtPoint, StatEvent } from '@/data/types';
import { isThreePoint, shotDistanceFt, shotZone, type ShotZone } from '@/lib/court';
import { formatPct } from '@/lib/format';

/** One 2PT or 3PT shot with a known location, as ShotMap and CourtPicker draw it. */
export interface Shot {
  location: CourtPoint;
  made: boolean;
}

/**
 * The shots to chart from a list of stat events (one game's, or a season's): every
 * 2PT and 3PT attempt that has a location, in event order. Free throws and shots
 * recorded without a location are left out.
 */
export function shotsFromEvents(events: readonly Pick<StatEvent, 'type' | 'location'>[]): Shot[] {
  const shots: Shot[] = [];
  for (const { type, location } of events) {
    if (!location) continue;
    switch (type) {
      case 'fg2_made':
      case 'fg3_made':
        shots.push({ location, made: true });
        break;
      case 'fg2_miss':
      case 'fg3_miss':
        shots.push({ location, made: false });
        break;
      default:
        break;
    }
  }
  return shots;
}

/** The zones in display order: closest to the basket first. */
export const SHOT_ZONES = ['paint', 'midrange', 'three'] as const satisfies readonly ShotZone[];

/** Short zone names for tiles and tables. */
export const SHOT_ZONE_LABELS: Record<ShotZone, string> = {
  paint: 'Paint',
  midrange: 'Mid-range',
  three: '3PT',
};

/** Full zone names, for screen readers. */
export const SHOT_ZONE_NAMES: Record<ShotZone, string> = {
  paint: 'Paint',
  midrange: 'Mid-range',
  three: '3-point range',
};

export interface MadeAttempted {
  made: number;
  attempted: number;
}

/** Made and attempted shots in each zone (see `shotZone` in src/lib/court.ts). */
export function shotsByZone(shots: readonly Shot[]): Record<ShotZone, MadeAttempted> {
  const zones: Record<ShotZone, MadeAttempted> = {
    paint: { made: 0, attempted: 0 },
    midrange: { made: 0, attempted: 0 },
    three: { made: 0, attempted: 0 },
  };
  for (const shot of shots) {
    const zone = zones[shotZone(shot.location)];
    zone.attempted += 1;
    if (shot.made) zone.made += 1;
  }
  return zones;
}

/** Made and attempted over all the shots. */
export function countShots(shots: readonly Shot[]): MadeAttempted {
  let made = 0;
  for (const shot of shots) if (shot.made) made += 1;
  return { made, attempted: shots.length };
}

/**
 * A text alternative for a shot map, e.g. "54 shots, 23 made (43%). Paint: 10 of 15.
 * Mid-range: 5 of 18. 3-point range: 8 of 21."
 */
export function describeShots(shots: readonly Shot[]): string {
  if (shots.length === 0) return 'No shots with a location yet.';
  const { made, attempted } = countShots(shots);
  const pct = formatPct(percentage(made, attempted));
  const zones = shotsByZone(shots);
  return [
    `${attempted} ${attempted === 1 ? 'shot' : 'shots'}, ${made} made (${pct}).`,
    ...SHOT_ZONES.map(
      (zone) => `${SHOT_ZONE_NAMES[zone]}: ${zones[zone].made} of ${zones[zone].attempted}.`,
    ),
  ].join(' ');
}

/** "2PT" or "3PT": what a shot from `point` is worth. */
export function shotValueLabel(point: CourtPoint): '2PT' | '3PT' {
  return isThreePoint(point) ? '3PT' : '2PT';
}

/** A picked spot for screen readers, e.g. "3-pointer, 23 feet from the basket". */
export function describeSpot(point: CourtPoint): string {
  const feet = Math.round(shotDistanceFt(point));
  const value = isThreePoint(point) ? '3-pointer' : '2-pointer';
  return `${value}, ${feet} ${feet === 1 ? 'foot' : 'feet'} from the basket`;
}
