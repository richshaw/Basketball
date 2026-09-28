import { describe, expect, it } from 'vitest';
import type { Shot } from '@/data/shots';
import { describeShots, describeSpot, locationNote, shotValueLabel } from './shotLabels';

const layup = { x: 0.5, y: 1 };
const elbow = { x: -8, y: 12 };
const corner = { x: 22, y: -3 };
const topOfKey = { x: 0, y: 23 };

describe('describeShots', () => {
  it('sums up the shots on the map and each zone', () => {
    const shots: Shot[] = [
      { made: true, points: 2, location: layup },
      { made: false, points: 2, location: layup },
      { made: true, points: 2, location: elbow },
      { made: false, points: 3, location: corner },
    ];
    expect(describeShots(shots)).toBe(
      '4 shots on the map, 2 made (50%). Paint: 1 of 2. Mid-range: 1 of 1. 3-pointers: 0 of 1.',
    );
  });

  it('says how many shots have a location, counting every 3-pointer', () => {
    const shots: Shot[] = [
      { made: true, points: 3, location: topOfKey },
      { made: true, points: 3 },
      { made: false, points: 2 },
    ];
    expect(describeShots(shots)).toBe(
      '1 shot on the map, 1 made (100%). Paint: 0 of 0. Mid-range: 0 of 0. 3-pointers: 2 of 2. ' +
        '1 of 3 shots has a location.',
    );
  });

  it('handles no shots, and shots with no location', () => {
    expect(describeShots([])).toBe('No shots yet.');
    expect(describeShots([{ made: true, points: 2 }])).toBe(
      'No shots on the map. Paint: 0 of 0. Mid-range: 0 of 0. 3-pointers: 0 of 0. ' +
        'The shot has no location.',
    );
  });
});

describe('locationNote', () => {
  it('counts the shots that have a location', () => {
    expect(locationNote(54, 60)).toBe('54 of 60 shots have a location');
    expect(locationNote(1, 3)).toBe('1 of 3 shots has a location');
    expect(locationNote(0, 2)).toBe('None of the 2 shots have a location');
    expect(locationNote(0, 1)).toBe('The shot has no location');
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
