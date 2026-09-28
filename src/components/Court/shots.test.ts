import { describe, expect, it } from 'vitest';
import type { StatEvent, StatType } from '@/data/types';
import {
  countShots,
  describeShots,
  describeSpot,
  shotsByZone,
  shotsFromEvents,
  shotValueLabel,
  type Shot,
} from './shots';

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

describe('shotsFromEvents', () => {
  it('keeps 2PT and 3PT attempts that have a location, in order', () => {
    const shots = shotsFromEvents([
      event('fg2_made', layup),
      event('fg3_miss', corner),
      event('fg2_miss', elbow),
      event('fg3_made', topOfKey),
    ]);
    expect(shots).toEqual([
      { location: layup, made: true },
      { location: corner, made: false },
      { location: elbow, made: false },
      { location: topOfKey, made: true },
    ]);
  });

  it('leaves out shots without a location, free throws and other stats', () => {
    const shots = shotsFromEvents([
      event('fg2_made'),
      event('fg3_miss'),
      event('ft_made'),
      event('ft_miss'),
      event('oreb'),
      event('ast'),
      event('fg2_miss', elbow),
    ]);
    expect(shots).toEqual([{ location: elbow, made: false }]);
  });

  it('ignores a location on a stat that is not a field goal', () => {
    // The repository never stores one, but old or imported data should not break the chart.
    expect(shotsFromEvents([event('ft_made', layup), event('stl', elbow)])).toEqual([]);
  });

  it('is empty for no events', () => {
    expect(shotsFromEvents([])).toEqual([]);
  });
});

function shot(location: Shot['location'], made: boolean): Shot {
  return { location, made };
}

describe('shotsByZone', () => {
  it('counts makes and attempts in the paint, mid-range and 3-point range', () => {
    const zones = shotsByZone([
      shot(layup, true),
      shot(layup, false),
      shot({ x: 5.9, y: 13 }, true),
      shot(elbow, true),
      shot({ x: 15, y: -2 }, false),
      shot(corner, true),
      shot(topOfKey, false),
      shot(topOfKey, false),
    ]);
    expect(zones).toEqual({
      paint: { made: 2, attempted: 3 },
      midrange: { made: 1, attempted: 2 },
      three: { made: 1, attempted: 3 },
    });
  });

  it('puts shots on the lines where the rules do', () => {
    const zones = shotsByZone([
      // On the free-throw line and the lane line: the paint (edges included).
      shot({ x: 0, y: 13.75 }, true),
      shot({ x: 6, y: 5 }, true),
      // On the three-point arc and the corner line: a two.
      shot({ x: 0, y: 19.75 }, true),
      shot({ x: -19.75, y: -3 }, true),
    ]);
    expect(zones.paint.attempted).toBe(2);
    expect(zones.midrange.attempted).toBe(2);
    expect(zones.three.attempted).toBe(0);
  });

  it('is all zeros for no shots', () => {
    expect(shotsByZone([])).toEqual({
      paint: { made: 0, attempted: 0 },
      midrange: { made: 0, attempted: 0 },
      three: { made: 0, attempted: 0 },
    });
  });
});

describe('countShots', () => {
  it('counts makes and attempts', () => {
    expect(countShots([shot(layup, true), shot(elbow, false), shot(corner, true)])).toEqual({
      made: 2,
      attempted: 3,
    });
    expect(countShots([])).toEqual({ made: 0, attempted: 0 });
  });
});

describe('describeShots', () => {
  it('sums up the shots and each zone', () => {
    expect(
      describeShots([
        shot(layup, true),
        shot(layup, false),
        shot(elbow, true),
        shot(corner, false),
      ]),
    ).toBe('4 shots, 2 made (50%). Paint: 1 of 2. Mid-range: 1 of 1. 3-point range: 0 of 1.');
  });

  it('handles one shot and no shots', () => {
    expect(describeShots([shot(corner, true)])).toBe(
      '1 shot, 1 made (100%). Paint: 0 of 0. Mid-range: 0 of 0. 3-point range: 1 of 1.',
    );
    expect(describeShots([])).toBe('No shots with a location yet.');
  });
});

describe('shotValueLabel and describeSpot', () => {
  it('names what a shot from the spot is worth', () => {
    expect(shotValueLabel(layup)).toBe('2PT');
    expect(shotValueLabel(elbow)).toBe('2PT');
    expect(shotValueLabel(corner)).toBe('3PT');
    expect(shotValueLabel(topOfKey)).toBe('3PT');
  });

  it('describes the spot for screen readers', () => {
    expect(describeSpot(topOfKey)).toBe('3-pointer, 23 feet from the basket');
    expect(describeSpot({ x: 0, y: 1 })).toBe('2-pointer, 1 foot from the basket');
    expect(describeSpot({ x: 0, y: 0 })).toBe('2-pointer, 0 feet from the basket');
  });
});
