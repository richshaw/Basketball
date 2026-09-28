import { describe, expect, it } from 'vitest';
import { BASELINE_Y, BASKET, FREE_THROW_LINE_Y, HALF_COURT_LINE_Y, SIDELINE_X } from '@/lib/court';
import {
  clientToCourt,
  COURT_SVG_HEIGHT,
  COURT_SVG_WIDTH,
  COURT_VIEW_BOX,
  COURT_VIEW_BOX_ATTRIBUTE,
  courtToSvg,
  svgToCourt,
} from './courtGeometry';
import { screenTransform, svgToClient, type ScreenTransform } from './courtTestUtils';

/** Stands in for an SVG element drawn with `transform` (null: not laid out). */
function fakeSvg(transform: ScreenTransform | null) {
  return { getScreenCTM: () => (transform ? screenTransform(transform) : null) };
}

describe('the court in SVG units', () => {
  it('is 10 units per foot, from the left end of the baseline', () => {
    expect(COURT_SVG_WIDTH).toBe(500);
    expect(COURT_SVG_HEIGHT).toBe(420);
    expect(courtToSvg({ x: -SIDELINE_X, y: BASELINE_Y })).toEqual({ x: 0, y: 0 });
    expect(courtToSvg({ x: SIDELINE_X, y: HALF_COURT_LINE_Y })).toEqual({ x: 500, y: 420 });
    expect(courtToSvg(BASKET)).toEqual({ x: 250, y: 52.5 });
    expect(courtToSvg({ x: 6, y: FREE_THROW_LINE_Y })).toEqual({ x: 310, y: 190 });
  });

  it('has the baseline at the top and the right sideline (+x) on the right', () => {
    expect(courtToSvg({ x: 10, y: 0 }).x).toBeGreaterThan(courtToSvg({ x: -10, y: 0 }).x);
    expect(courtToSvg({ x: 0, y: 20 }).y).toBeGreaterThan(courtToSvg(BASKET).y);
    expect(courtToSvg({ x: 0, y: BASELINE_Y }).y).toBe(0);
  });

  it('views the court with a foot of floor around the lines', () => {
    expect(COURT_VIEW_BOX).toEqual({ x: -10, y: -10, width: 520, height: 440 });
    expect(COURT_VIEW_BOX_ATTRIBUTE).toBe('-10 -10 520 440');
  });
});

describe('svgToCourt', () => {
  it('undoes courtToSvg', () => {
    for (const point of [
      BASKET,
      { x: -SIDELINE_X, y: BASELINE_Y },
      { x: SIDELINE_X, y: HALF_COURT_LINE_Y },
      { x: 0, y: FREE_THROW_LINE_Y },
      { x: 19.75, y: 0 },
      { x: 3.37, y: 12.05 },
      { x: -19.8, y: -2.4 },
      { x: 14.2, y: 14.2 },
      { x: -0.01, y: 30.7 },
    ]) {
      const { x, y } = courtToSvg(point);
      expect(svgToCourt(x, y)).toEqual(point);
    }
  });

  it('rounds to a hundredth of a foot', () => {
    expect(svgToCourt(283.744, 173.46)).toEqual({ x: 3.37, y: 12.1 });
    expect(svgToCourt(250.04, 52.5)).toEqual({ x: 0, y: 0 });
  });

  it('never returns -0', () => {
    const point = svgToCourt(249.98, 52.48);
    expect(point).toEqual({ x: 0, y: 0 });
    expect(Object.is(point.x, -0)).toBe(false);
    expect(Object.is(point.y, -0)).toBe(false);
  });

  it('moves points off the court onto its nearest edge', () => {
    // On the floor around the court, and beyond the drawing.
    expect(svgToCourt(-8, -9)).toEqual({ x: -SIDELINE_X, y: BASELINE_Y });
    expect(svgToCourt(505, 200)).toEqual({ x: SIDELINE_X, y: 14.75 });
    expect(svgToCourt(250, 1000)).toEqual({ x: 0, y: HALF_COURT_LINE_Y });
  });
});

describe('clientToCourt', () => {
  // Drawn at half size, with SVG (0, 0) at (20, 100) on screen.
  const halfSize = { scale: 0.5, originX: 20, originY: 100 };

  it('maps a tap back through the screen transform', () => {
    const svg = fakeSvg(halfSize);
    // The basket is (250, 52.5) in SVG units.
    expect(clientToCourt(svg, 145, 126.25)).toEqual({ x: 0, y: 0 });
    // The middle of the free-throw line, (250, 190).
    expect(clientToCourt(svg, 145, 195)).toEqual({ x: 0, y: FREE_THROW_LINE_Y });
    // The right corner, near the baseline: (480, 22.5).
    expect(clientToCourt(svg, 260, 111.25)).toEqual({ x: 23, y: -3 });
  });

  it('works at any rendered size', () => {
    const point = { x: -12.4, y: 21.6 };
    for (const scale of [0.4, 0.69, 1, 2.5]) {
      const transform = { scale, originX: 16, originY: 300 };
      const { clientX, clientY } = svgToClient(courtToSvg(point), transform);
      expect(clientToCourt(fakeSvg(transform), clientX, clientY)).toEqual(point);
    }
  });

  it('moves taps just outside the court onto it', () => {
    const svg = fakeSvg({ scale: 1, originX: 10, originY: 10 });
    // Half a foot past the right sideline, level with the basket.
    expect(clientToCourt(svg, 515, 62.5)).toEqual({ x: SIDELINE_X, y: 0 });
  });

  it('returns null when the SVG is not laid out', () => {
    expect(clientToCourt(fakeSvg(null), 10, 10)).toBeNull();
    // Zero size: the transform has no inverse (NaN from DOMMatrix, a throw from SVGMatrix).
    expect(clientToCourt(fakeSvg({ scale: 0, originX: 0, originY: 0 }), 10, 10)).toBeNull();
    const throwing = {
      getScreenCTM: () =>
        ({
          inverse: () => {
            throw new DOMException('Not invertible', 'InvalidStateError');
          },
        }) as unknown as DOMMatrix,
    };
    expect(clientToCourt(throwing, 10, 10)).toBeNull();
  });
});
