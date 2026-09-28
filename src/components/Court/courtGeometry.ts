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
 * Floor drawn beyond the lines, so the boundary lines aren't clipped and the court
 * clears the rounded corners of its frame.
 */
const APRON = feetToSvg(1);

/** The shallowest court `courtViewBox` shows, in feet from the baseline. */
const MIN_DEPTH = 1;

/** A rectangle in SVG units, e.g. a view box. */
export interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a court drawing shows: from the floor behind the baseline to `depth` feet from
 * the baseline. By default that's the whole half court, with floor past the half-court
 * line too. A shallower depth (1 to 42 ft) crops the far end, e.g. to leave room for
 * buttons below; anything deeper than the crop is cut off.
 */
export function courtViewBox(depth: number = HALF_COURT_DEPTH): ViewBox {
  const feet = Number.isFinite(depth)
    ? Math.min(Math.max(depth, MIN_DEPTH), HALF_COURT_DEPTH)
    : HALF_COURT_DEPTH;
  const bottom = feet < HALF_COURT_DEPTH ? feetToSvg(feet) : COURT_SVG_HEIGHT + APRON;
  return { x: -APRON, y: -APRON, width: COURT_SVG_WIDTH + 2 * APRON, height: bottom + APRON };
}

/** The whole half court's view box. */
export const COURT_VIEW_BOX: ViewBox = courtViewBox();

/** A view box as an SVG `viewBox` attribute: 'x y width height'. */
export function viewBoxAttribute({ x, y, width, height }: ViewBox): string {
  return `${x} ${y} ${width} ${height}`;
}

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

/** An SVG's view box, from its `viewBox` attribute; null if it has none that works. */
function readViewBox(svg: Pick<Element, 'getAttribute'>): ViewBox | null {
  const numbers = (svg.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const [x = NaN, y = NaN, width = NaN, height = NaN] = numbers;
  if (numbers.length !== 4 || ![x, y].every(Number.isFinite)) return null;
  return width > 0 && height > 0 && Number.isFinite(width + height)
    ? { x, y, width, height }
    : null;
}

/**
 * The court point under a tap or click at (clientX, clientY), e.g. a pointer event's
 * coordinates, on a court drawn by HalfCourt (at any size and depth). It maps the tap
 * through the SVG's box on screen and its view box, drawn scaled to fit and centered
 * (preserveAspectRatio "xMidYMid meet"). That box includes CSS transforms on the SVG's
 * ancestors, which Safari's getScreenCTM leaves out. Assumes no border or padding on
 * the SVG (HalfCourt has none). Clamped onto the half court like `svgToCourt`; null if
 * the SVG isn't laid out (nothing to map onto).
 */
export function clientToCourt(
  svg: Pick<Element, 'getAttribute' | 'getBoundingClientRect'>,
  clientX: number,
  clientY: number,
): CourtPoint | null {
  const viewBox = readViewBox(svg);
  const box = svg.getBoundingClientRect();
  if (!viewBox || !(box.width > 0 && box.height > 0)) return null;
  const scale = Math.min(box.width / viewBox.width, box.height / viewBox.height);
  const left = box.left + (box.width - viewBox.width * scale) / 2;
  const top = box.top + (box.height - viewBox.height * scale) / 2;
  const x = viewBox.x + (clientX - left) / scale;
  const y = viewBox.y + (clientY - top) / scale;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return svgToCourt(x, y);
}

/** Whether (clientX, clientY) is on the element's box on screen, edges included. */
export function isOverBox(
  element: Pick<Element, 'getBoundingClientRect'>,
  clientX: number,
  clientY: number,
): boolean {
  const box = element.getBoundingClientRect();
  return clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
}
