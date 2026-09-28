import { describe, expect, it } from 'vitest';
import { BASELINE_Y, BASKET, FREE_THROW_LINE_Y, HALF_COURT_LINE_Y, SIDELINE_X } from '@/lib/court';
import {
  clientToCourt,
  COURT_SVG_HEIGHT,
  COURT_SVG_WIDTH,
  COURT_VIEW_BOX,
  courtToSvg,
  courtViewBox,
  isOverBox,
  svgToCourt,
  viewBoxAttribute,
  type ViewBox,
} from './courtGeometry';
import {
  courtBox,
  domRect,
  svgToClient,
  type CourtPlacement,
  type ScreenBox,
} from './courtTestUtils';

/** Stands in for an SVG element with this view box attribute, laid out at `box`. */
function fakeSvg(viewBox: string | null, box: ScreenBox) {
  return {
    getAttribute: (name: string) => (name === 'viewBox' ? viewBox : null),
    getBoundingClientRect: () => domRect(box),
  };
}

/** A fake SVG drawing `viewBox` placed like this. */
function placedSvg(placement: CourtPlacement) {
  return fakeSvg(viewBoxAttribute(placement.viewBox ?? COURT_VIEW_BOX), courtBox(placement));
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
});

describe('courtViewBox', () => {
  it('shows the whole half court with a foot of floor around the lines by default', () => {
    expect(courtViewBox()).toEqual({ x: -10, y: -10, width: 520, height: 440 });
    expect(COURT_VIEW_BOX).toEqual(courtViewBox());
    expect(viewBoxAttribute(COURT_VIEW_BOX)).toBe('-10 -10 520 440');
  });

  it('crops the far end to a depth from the baseline', () => {
    // 30 ft from the baseline is 24.75 ft from the basket, past the top of the arc.
    expect(courtViewBox(30)).toEqual({ x: -10, y: -10, width: 520, height: 310 });
    expect(courtViewBox(30).y + courtViewBox(30).height).toBe(courtToSvg({ x: 0, y: 24.75 }).y);
    expect(courtViewBox(41.5).height).toBe(425);
  });

  it('keeps the depth between 1 ft and the half-court line', () => {
    expect(courtViewBox(50)).toEqual(courtViewBox());
    expect(courtViewBox(0).height).toBe(20);
    expect(courtViewBox(-5).height).toBe(20);
    expect(courtViewBox(Number.NaN)).toEqual(courtViewBox());
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
  // Drawn at half size, with the view box's corner at (15, 95): SVG (0, 0) is at (20, 100).
  const halfSize = { scale: 0.5, left: 15, top: 95 };

  it('maps a tap back through the drawing on screen', () => {
    const svg = placedSvg(halfSize);
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
      const placement = { scale, left: 16, top: 300 };
      const { clientX, clientY } = svgToClient(courtToSvg(point), placement);
      expect(clientToCourt(placedSvg(placement), clientX, clientY)).toEqual(point);
    }
  });

  it('works on a cropped court', () => {
    const viewBox: ViewBox = courtViewBox(30);
    const placement = { scale: 0.7, left: 16, top: 40, viewBox };
    for (const point of [BASKET, { x: 22, y: -3 }, { x: -5.5, y: 23.8 }]) {
      const { clientX, clientY } = svgToClient(courtToSvg(point), placement);
      expect(clientToCourt(placedSvg(placement), clientX, clientY)).toEqual(point);
    }
  });

  it('finds the drawing in a box of other proportions, scaled to fit and centered', () => {
    // 400 x 220: the 520 x 440 view box fits at half size, 70px in from each side.
    const svg = fakeSvg('-10 -10 520 440', { left: 0, top: 0, width: 400, height: 220 });
    expect(clientToCourt(svg, 200, 31.25)).toEqual({ x: 0, y: 0 });
    expect(clientToCourt(svg, 70, 5)).toEqual({ x: -SIDELINE_X, y: BASELINE_Y });
  });

  it('moves taps just outside the court onto it', () => {
    const svg = placedSvg({ scale: 1, left: 0, top: 0 });
    // Half a foot past the right sideline, level with the basket.
    expect(clientToCourt(svg, 515, 62.5)).toEqual({ x: SIDELINE_X, y: 0 });
  });

  it('returns null when there is nothing to map onto', () => {
    const box = { left: 0, top: 0, width: 260, height: 220 };
    // Not laid out (e.g. hidden).
    expect(clientToCourt(fakeSvg('-10 -10 520 440', { ...box, width: 0, height: 0 }), 5, 5)).toBe(
      null,
    );
    // No view box, or one that makes no sense.
    expect(clientToCourt(fakeSvg(null, box), 5, 5)).toBeNull();
    expect(clientToCourt(fakeSvg('0 0 520', box), 5, 5)).toBeNull();
    expect(clientToCourt(fakeSvg('0 0 0 440', box), 5, 5)).toBeNull();
    expect(clientToCourt(fakeSvg('a b c d', box), 5, 5)).toBeNull();
  });
});

describe('isOverBox', () => {
  it('is true on the box, edges included', () => {
    const element = {
      getBoundingClientRect: () => domRect({ left: 10, top: 20, width: 100, height: 50 }),
    };
    expect(isOverBox(element, 10, 20)).toBe(true);
    expect(isOverBox(element, 110, 70)).toBe(true);
    expect(isOverBox(element, 60, 45)).toBe(true);
    expect(isOverBox(element, 110.5, 45)).toBe(false);
    expect(isOverBox(element, 60, 19.5)).toBe(false);
  });
});
