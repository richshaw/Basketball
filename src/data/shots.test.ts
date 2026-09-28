import { describe, expect, it } from 'vitest';
import {
  countShots,
  hasLocation,
  SHOT_ZONES,
  shotChartSection,
  shotsByZone,
  shotsFromEvents,
  shotZoneOf,
  type Shot,
} from './shots';
import { computeStatLine } from './stats';
import type { StatEvent, StatType } from './types';

let nextId = 1;
function event(type: StatType, location?: StatEvent['location']): StatEvent {
  const id = nextId++;
  return {
    id: `event-${id}`,
    gameId: 'game-1',
    type,
    period: 1,
    createdAt: id,
    ...(location ? { location } : {}),
  };
}

const layup = { x: 0.5, y: 1 };
const elbow = { x: -8, y: 12 };
const corner = { x: 22, y: -3 };
const topOfKey = { x: 0, y: 23 };
/** Just inside the arc: a 3PT attempt recorded here still counts as a three. */
const insideArc = { x: 0, y: 19 };

describe('shotsFromEvents', () => {
  it('keeps every 2PT and 3PT attempt, in order, with its value and location', () => {
    const shots = shotsFromEvents([
      event('fg2_made', layup),
      event('fg3_miss', corner),
      event('fg2_miss'),
      event('fg3_made', topOfKey),
      event('fg3_made'),
    ]);
    expect(shots).toEqual([
      { made: true, points: 2, location: layup },
      { made: false, points: 3, location: corner },
      { made: false, points: 2 },
      { made: true, points: 3, location: topOfKey },
      { made: true, points: 3 },
    ]);
  });

  it('leaves out free throws and other stats, even with a location', () => {
    // The repository never stores one there, but old or imported data shouldn't break the chart.
    const shots = shotsFromEvents([
      event('ft_made'),
      event('ft_miss', layup),
      event('oreb'),
      event('stl', elbow),
      event('fg2_miss', elbow),
    ]);
    expect(shots).toEqual([{ made: false, points: 2, location: elbow }]);
  });

  it('is empty for no events', () => {
    expect(shotsFromEvents([])).toEqual([]);
  });
});

describe('hasLocation', () => {
  it('tells shots with a spot from those without', () => {
    const [located, unlocated] = shotsFromEvents([event('fg2_made', layup), event('fg2_made')]);
    expect(located && hasLocation(located)).toBe(true);
    expect(unlocated && hasLocation(unlocated)).toBe(false);
  });
});

function shot(points: 2 | 3, made: boolean, location?: Shot['location']): Shot {
  return location ? { made, points, location } : { made, points };
}

describe('shotZoneOf', () => {
  it('counts every 3PT attempt as a three, wherever it was tapped', () => {
    expect(shotZoneOf(shot(3, true, corner))).toBe('three');
    expect(shotZoneOf(shot(3, true, insideArc))).toBe('three');
    expect(shotZoneOf(shot(3, false, layup))).toBe('three');
    expect(shotZoneOf(shot(3, false))).toBe('three');
  });

  it('puts a 2PT attempt in the paint or mid-range by its location', () => {
    expect(shotZoneOf(shot(2, true, layup))).toBe('paint');
    // On the free-throw line and the lane line: the paint (edges included).
    expect(shotZoneOf(shot(2, true, { x: 0, y: 13.75 }))).toBe('paint');
    expect(shotZoneOf(shot(2, true, { x: 6, y: 5 }))).toBe('paint');
    expect(shotZoneOf(shot(2, true, elbow))).toBe('midrange');
    // A two from beyond the arc (a foot on the line, as the parent saw it) is mid-range.
    expect(shotZoneOf(shot(2, false, topOfKey))).toBe('midrange');
  });

  it('has no zone for a 2PT attempt without a location', () => {
    expect(shotZoneOf(shot(2, true))).toBeNull();
  });
});

describe('shotsByZone', () => {
  it('agrees with the box score on threes, and splits located twos', () => {
    const events = [
      event('fg2_made', layup),
      event('fg2_miss', layup),
      event('fg2_made', { x: 5.9, y: 13 }),
      event('fg2_made', elbow),
      event('fg2_miss', { x: 15, y: -2 }),
      event('fg2_miss'),
      event('fg3_made', corner),
      event('fg3_made', insideArc),
      event('fg3_miss', topOfKey),
      event('fg3_miss'),
    ];
    const zones = shotsByZone(shotsFromEvents(events));
    expect(zones).toEqual({
      paint: { made: 2, attempted: 3 },
      midrange: { made: 1, attempted: 2 },
      three: { made: 2, attempted: 4 },
    });

    const line = computeStatLine(events);
    expect(zones.three).toEqual({ made: line.fg3m, attempted: line.fg3a });
    // The one 2PT attempt without a location is in neither 2PT zone.
    expect(zones.paint.attempted + zones.midrange.attempted).toBe(line.fg2a - 1);
  });

  it('is all zeros for no shots', () => {
    expect(shotsByZone([])).toEqual({
      paint: { made: 0, attempted: 0 },
      midrange: { made: 0, attempted: 0 },
      three: { made: 0, attempted: 0 },
    });
  });

  it('lists the zones closest to the basket first', () => {
    expect(SHOT_ZONES).toEqual(['paint', 'midrange', 'three']);
  });
});

describe('countShots', () => {
  it('counts makes and attempts', () => {
    expect(countShots([shot(2, true, layup), shot(3, false), shot(2, true)])).toEqual({
      made: 2,
      attempted: 3,
    });
    expect(countShots([])).toEqual({ made: 0, attempted: 0 });
  });
});

describe('shotChartSection', () => {
  it('shows the map once any shot has a spot, whatever the setting', () => {
    const someSpots = [shot(2, false), shot(3, true, corner), shot(2, true)];
    for (const askForSpots of [true, false]) {
      expect(shotChartSection([shot(2, true, layup)], askForSpots)).toBe('map');
      expect(shotChartSection(someSpots, askForSpots)).toBe('map');
    }
  });

  it('notes that no spots were recorded while the setting asks for them', () => {
    expect(shotChartSection([shot(2, true), shot(3, false)], true)).toBe('noSpots');
  });

  it('leaves the section out with no spots and the setting off', () => {
    expect(shotChartSection([shot(2, true), shot(3, false)], false)).toBeNull();
  });

  it('leaves the section out when there are no shots', () => {
    expect(shotChartSection([], true)).toBeNull();
    expect(shotChartSection([], false)).toBeNull();
    // Free throws aren't shots on the map.
    expect(
      shotChartSection(shotsFromEvents([event('ft_made'), event('ft_miss')]), true),
    ).toBeNull();
  });
});
