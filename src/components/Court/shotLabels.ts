/**
 * Words for the shot chart: zone names, the value of a spot on the court, and text
 * alternatives for screen readers. The shot math itself is in src/data/shots.ts.
 */
import { countShots, hasLocation, SHOT_ZONES, shotsByZone, type Shot } from '@/data/shots';
import { percentage } from '@/data/stats';
import type { CourtPoint } from '@/data/types';
import { isThreePoint, shotDistanceFt, type ShotZone } from '@/lib/court';
import { formatPct } from '@/lib/format';

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
  three: '3-pointers',
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** e.g. "54 of 60 shots have a location": how many of the shots a shot map can show. */
export function locationNote(located: number, total: number): string {
  if (located === 0) {
    return total === 1 ? 'The shot has no location' : `None of the ${total} shots have a location`;
  }
  return `${located} of ${plural(total, 'shot')} ${located === 1 ? 'has' : 'have'} a location`;
}

/**
 * A text alternative for a shot map, e.g. "54 shots on the map, 23 made (43%). Paint:
 * 10 of 15. Mid-range: 5 of 18. 3-pointers: 8 of 23. 54 of 60 shots have a location."
 * Zones count as in `shotsByZone`, so 3-pointers include those with no location.
 */
export function describeShots(shots: readonly Shot[]): string {
  if (shots.length === 0) return 'No shots yet.';
  const located = shots.filter(hasLocation);
  const { made, attempted } = countShots(located);
  const zones = shotsByZone(shots);
  const sentences = [
    attempted === 0
      ? 'No shots on the map.'
      : `${plural(attempted, 'shot')} on the map, ${made} made (${formatPct(percentage(made, attempted))}).`,
    ...SHOT_ZONES.map(
      (zone) => `${SHOT_ZONE_NAMES[zone]}: ${zones[zone].made} of ${zones[zone].attempted}.`,
    ),
  ];
  if (located.length < shots.length) {
    sentences.push(`${locationNote(located.length, shots.length)}.`);
  }
  return sentences.join(' ');
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
