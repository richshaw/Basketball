/**
 * How the half court is laid out in SVG, and conversions between court feet
 * (`CourtPoint`, see src/lib/court.ts), SVG units and screen taps.
 *
 * The SVG uses 10 units per foot with the baseline at the TOP, like most stat apps:
 * the viewer stands at half court facing the basket, so the right sideline (+x) is
 * on the right and +y (toward half court) points down the screen. SVG (0, 0) is where
 * the baseline meets the left sideline, and (500, 420) is the right end of the
 * half-court line.
 */
import type { CourtPoint } from '@/data/types';
import {
  BASELINE_Y,
  clampToHalfCourt,
  COURT_WIDTH,
  HALF_COURT_DEPTH,
  SIDELINE_X,
} from '@/lib/court';

export const SVG_UNITS_PER_FOOT = 10;

/** Feet to SVG units, for lengths such as radii. */
export function feetToSvg(feet: number): number {
  return feet * SVG_UNITS_PER_FOOT;
}

/** The half court itself, sideline to sideline and baseline to half court. */
export const COURT_SVG_WIDTH = feetToSvg(COURT_WIDTH);
export const COURT_SVG_HEIGHT = feetToSvg(HALF_COURT_DEPTH);

/**
 * Floor drawn beyond the lines on every side, so the boundary lines aren't clipped
 * and the court clears the rounded corners of its frame.
 */
const APRON = feetToSvg(1);

/** The drawing's view box: the half court plus the apron around it. */
export const COURT_VIEW_BOX = {
  x: -APRON,
  y: -APRON,
  width: COURT_SVG_WIDTH + 2 * APRON,
  height: COURT_SVG_HEIGHT + 2 * APRON,
} as const;

export const COURT_VIEW_BOX_ATTRIBUTE = [
  COURT_VIEW_BOX.x,
  COURT_VIEW_BOX.y,
  COURT_VIEW_BOX.width,
  COURT_VIEW_BOX.height,
].join(' ');

/** A point in SVG units. */
export interface SvgPoint {
  x: number;
  y: number;
}

/** Where a court point (feet) is drawn, in SVG units. */
export function courtToSvg(point: CourtPoint): SvgPoint {
  return {
    x: feetToSvg(point.x + SIDELINE_X),
    y: feetToSvg(point.y - BASELINE_Y),
  };
}

/**
 * To a hundredth of a foot: far finer than a tap, short in a backup, and every line
 * of the court (they're at quarter feet) stays exact. Never -0: JSON can't keep it.
 */
function roundFeet(feet: number): number {
  return Math.round(feet * 100) / 100 || 0;
}

/**
 * The court point (feet) at an SVG position, rounded to a hundredth of a foot and
 * moved onto the half court (a tap on the floor around it lands on the nearest line).
 */
export function svgToCourt(x: number, y: number): CourtPoint {
  return clampToHalfCourt({
    x: roundFeet(x / SVG_UNITS_PER_FOOT - SIDELINE_X),
    y: roundFeet(y / SVG_UNITS_PER_FOOT + BASELINE_Y),
  });
}

/**
 * The court point under a tap or click at (clientX, clientY), e.g. a pointer event's
 * coordinates, on a court drawn by HalfCourt. Works at any rendered size: the SVG's
 * screen transform (getScreenCTM) maps the tap back into SVG units. Clamped onto the
 * half court like `svgToCourt`; null if the SVG isn't laid out (nothing to map onto).
 */
export function clientToCourt(
  svg: Pick<SVGGraphicsElement, 'getScreenCTM'>,
  clientX: number,
  clientY: number,
): CourtPoint | null {
  const toScreen = svg.getScreenCTM();
  if (!toScreen) return null;
  let toSvg: DOMMatrix;
  try {
    toSvg = toScreen.inverse();
  } catch {
    // A zero-size SVG has no inverse (SVGMatrix throws; DOMMatrix returns NaNs).
    return null;
  }
  const x = toSvg.a * clientX + toSvg.c * clientY + toSvg.e;
  const y = toSvg.b * clientX + toSvg.d * clientY + toSvg.f;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return svgToCourt(x, y);
}
