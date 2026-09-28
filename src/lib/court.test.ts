import { describe, expect, it } from 'vitest';
import {
  BACKBOARD_Y,
  BASELINE_Y,
  clampToHalfCourt,
  FREE_THROW_CIRCLE_RADIUS,
  FREE_THROW_LINE_Y,
  HALF_COURT_LINE_Y,
  isInPaint,
  isOnHalfCourt,
  isThreePoint,
  LANE_WIDTH,
  shotDistanceFt,
  shotZone,
  SIDELINE_X,
  THREE_POINT_CORNER_TOP_Y,
  THREE_POINT_CORNER_X,
  THREE_POINT_RADIUS,
} from './court';

describe('court geometry', () => {
  it('matches a high-school half court in basket-centered feet', () => {
    expect(BASELINE_Y).toBe(-5.25);
    expect(HALF_COURT_LINE_Y).toBe(36.75);
    expect(SIDELINE_X).toBe(25);
    expect(BACKBOARD_Y).toBe(-1.25);
    // Free-throw line: 19 ft from the baseline, 15 ft from the backboard.
    expect(FREE_THROW_LINE_Y).toBe(13.75);
    expect(FREE_THROW_LINE_Y - BACKBOARD_Y).toBe(15);
    expect(LANE_WIDTH).toBe(12);
    expect(FREE_THROW_CIRCLE_RADIUS).toBe(6);
  });

  it('joins the corner lines to the arc without a step', () => {
    const top = { x: THREE_POINT_CORNER_X, y: THREE_POINT_CORNER_TOP_Y };
    expect(shotDistanceFt(top)).toBe(THREE_POINT_RADIUS);
  });
});

describe('shotDistanceFt', () => {
  it('measures from the center of the basket', () => {
    expect(shotDistanceFt({ x: 0, y: 0 })).toBe(0);
    expect(shotDistanceFt({ x: 3, y: 4 })).toBe(5);
    expect(shotDistanceFt({ x: -6, y: -8 })).toBe(10);
  });
});

describe('isThreePoint', () => {
  it('uses the arc above the basket', () => {
    expect(isThreePoint({ x: 0, y: 19.8 })).toBe(true);
    expect(isThreePoint({ x: 0, y: 19.7 })).toBe(false);
    // 45 degrees: 14 * sqrt(2) = 19.80, 13.9 * sqrt(2) = 19.66.
    expect(isThreePoint({ x: 14, y: 14 })).toBe(true);
    expect(isThreePoint({ x: -13.9, y: 13.9 })).toBe(false);
    expect(isThreePoint({ x: 0, y: 30 })).toBe(true);
  });

  it('counts a foot on the line as two', () => {
    expect(isThreePoint({ x: 0, y: THREE_POINT_RADIUS })).toBe(false);
    expect(isThreePoint({ x: THREE_POINT_CORNER_X, y: -3 })).toBe(false);
  });

  it('uses the straight corner lines at or below the basket', () => {
    expect(isThreePoint({ x: 20, y: -3 })).toBe(true);
    expect(isThreePoint({ x: -20, y: -5 })).toBe(true);
    expect(isThreePoint({ x: 19.8, y: 0 })).toBe(true);
    expect(isThreePoint({ x: -19.7, y: 0 })).toBe(false);
  });

  it('is a two inside the corner line even when farther than 19.75 ft', () => {
    const corner = { x: 19.6, y: -4 };
    expect(shotDistanceFt(corner)).toBeGreaterThan(THREE_POINT_RADIUS);
    expect(isThreePoint(corner)).toBe(false);
    expect(isThreePoint({ x: -19.6, y: -4 })).toBe(false);
  });

  it('switches from the corner line to the arc at the basket line', () => {
    expect(isThreePoint({ x: 19.76, y: 0.01 })).toBe(true);
    expect(isThreePoint({ x: 19.74, y: 0.01 })).toBe(false);
    expect(isThreePoint({ x: 19.6, y: 2.5 })).toBe(true);
  });
});

describe('shotZone', () => {
  it('finds the paint, midrange and three', () => {
    expect(shotZone({ x: 0, y: 1 })).toBe('paint');
    expect(shotZone({ x: 5.9, y: 13 })).toBe('paint');
    expect(shotZone({ x: -6, y: FREE_THROW_LINE_Y })).toBe('paint');
    expect(shotZone({ x: 6.1, y: 5 })).toBe('midrange');
    expect(shotZone({ x: 0, y: 14 })).toBe('midrange');
    expect(shotZone({ x: 15, y: -2 })).toBe('midrange');
    expect(shotZone({ x: 0, y: 22 })).toBe('three');
    expect(shotZone({ x: -22, y: -2 })).toBe('three');
    expect(isInPaint({ x: 0, y: 14 })).toBe(false);
  });
});

describe('clampToHalfCourt', () => {
  it('moves points onto the half court', () => {
    expect(clampToHalfCourt({ x: 30, y: 40 })).toEqual({ x: 25, y: 36.75 });
    expect(clampToHalfCourt({ x: -30, y: -10 })).toEqual({ x: -25, y: -5.25 });
    expect(clampToHalfCourt({ x: 3, y: 12 })).toEqual({ x: 3, y: 12 });
  });

  it('keeps points that are on the lines', () => {
    const corner = { x: -SIDELINE_X, y: BASELINE_Y };
    expect(isOnHalfCourt(corner)).toBe(true);
    expect(clampToHalfCourt(corner)).toEqual(corner);
    expect(isOnHalfCourt({ x: 0, y: HALF_COURT_LINE_Y + 0.1 })).toBe(false);
  });
});
