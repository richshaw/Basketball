/**
 * High-school (NFHS) half-court geometry, in feet.
 *
 * Coordinates are `CourtPoint`s: the origin is the center of the basket, +x points
 * to the right sideline as seen from half court facing the basket, and +y points
 * toward half court. So the baseline is at y = -5.25, the sidelines are at x = ±25
 * and the half-court line is at y = 36.75. The shot chart draws its SVG from these
 * constants, so every line on the court is defined here.
 */
import type { CourtPoint } from '@/data/types';

/** Sideline to sideline. */
export const COURT_WIDTH = 50;
/** Baseline to the half-court line. */
export const HALF_COURT_DEPTH = 42;
/** Baseline to the center of the basket. */
export const BASKET_FROM_BASELINE = 5.25;

export const BASKET: CourtPoint = { x: 0, y: 0 };
export const BASELINE_Y = -BASKET_FROM_BASELINE;
export const HALF_COURT_LINE_Y = BASELINE_Y + HALF_COURT_DEPTH;
/** The sidelines are at x = ±SIDELINE_X. */
export const SIDELINE_X = COURT_WIDTH / 2;

/** Baseline to the face of the backboard. */
export const BACKBOARD_FROM_BASELINE = 4;
export const BACKBOARD_Y = BASELINE_Y + BACKBOARD_FROM_BASELINE;
export const BACKBOARD_WIDTH = 6;
/** Inside radius of the rim (18-inch ring), centered on the basket. */
export const RIM_RADIUS = 0.75;

/** The lane (the paint) runs from the baseline to the free-throw line, centered on x = 0. */
export const LANE_WIDTH = 12;
/** Baseline to the free-throw line (15 feet from the backboard). */
export const FREE_THROW_LINE_FROM_BASELINE = 19;
export const FREE_THROW_LINE_Y = BASELINE_Y + FREE_THROW_LINE_FROM_BASELINE;
/** Centered on the middle of the free-throw line. */
export const FREE_THROW_CIRCLE_RADIUS = 6;

/** The three-point arc's radius, centered on the basket. */
export const THREE_POINT_RADIUS = 19.75;
/** The straight corner three-point lines are at x = ±THREE_POINT_CORNER_X... */
export const THREE_POINT_CORNER_X = 19.75;
/** ...running from the baseline up to this y, where they meet the arc. */
export const THREE_POINT_CORNER_TOP_Y = 0;

/** Centered on the middle of the half-court line (half of it is on this half). */
export const CENTER_CIRCLE_RADIUS = 6;

export type ShotZone = 'paint' | 'midrange' | 'three';

/** Straight-line distance from the center of the basket, in feet. */
export function shotDistanceFt(point: CourtPoint): number {
  return Math.hypot(point.x - BASKET.x, point.y - BASKET.y);
}

/**
 * Whether a shot from `point` is worth three: beyond the straight corner lines at
 * or below the basket, beyond the arc above it. A foot on the line is a two.
 */
export function isThreePoint(point: CourtPoint): boolean {
  if (point.y <= THREE_POINT_CORNER_TOP_Y) return Math.abs(point.x) > THREE_POINT_CORNER_X;
  return shotDistanceFt(point) > THREE_POINT_RADIUS;
}

/** Whether `point` is inside the lane (edges included). */
export function isInPaint(point: CourtPoint): boolean {
  return Math.abs(point.x) <= LANE_WIDTH / 2 && point.y <= FREE_THROW_LINE_Y;
}

/** 'three' beyond the three-point line, 'paint' inside the lane, 'midrange' anywhere else. */
export function shotZone(point: CourtPoint): ShotZone {
  if (isThreePoint(point)) return 'three';
  return isInPaint(point) ? 'paint' : 'midrange';
}

/** Moves a point onto the half court (e.g. a tap just past a line). */
export function clampToHalfCourt(point: CourtPoint): CourtPoint {
  return {
    x: Math.min(Math.max(point.x, -SIDELINE_X), SIDELINE_X),
    y: Math.min(Math.max(point.y, BASELINE_Y), HALF_COURT_LINE_Y),
  };
}

/** Whether `point` is on the half court (lines included). */
export function isOnHalfCourt(point: CourtPoint): boolean {
  return Math.abs(point.x) <= SIDELINE_X && point.y >= BASELINE_Y && point.y <= HALF_COURT_LINE_Y;
}

/**
 * Whether `value` is a point with finite coordinates: not NaN or Infinity (e.g. from a
 * court measured at zero size), nor anything else read back from storage.
 */
export function isRealPoint(value: unknown): value is CourtPoint {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return Number.isFinite(x) && Number.isFinite(y);
}
