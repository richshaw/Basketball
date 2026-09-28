import type { ComponentPropsWithRef, ReactNode } from 'react';
import {
  BACKBOARD_WIDTH,
  BACKBOARD_Y,
  BASELINE_Y,
  BASKET,
  CENTER_CIRCLE_RADIUS,
  FREE_THROW_CIRCLE_RADIUS,
  FREE_THROW_LINE_Y,
  HALF_COURT_LINE_Y,
  LANE_WIDTH,
  RIM_RADIUS,
  THREE_POINT_CORNER_TOP_Y,
  THREE_POINT_CORNER_X,
  THREE_POINT_RADIUS,
} from '@/lib/court';
import { cx } from '@/lib/cx';
import {
  COURT_SVG_HEIGHT,
  COURT_SVG_WIDTH,
  COURT_VIEW_BOX,
  COURT_VIEW_BOX_ATTRIBUTE,
  courtToSvg,
  feetToSvg,
} from './courtGeometry';
import styles from './HalfCourt.module.css';

/** Line widths in SVG units (10 per foot): about 2px on a phone-wide court. */
const LINE_WIDTH = 2.75;
const BACKBOARD_LINE_WIDTH = 4.5;

/**
 * The free-throw circle's half inside the lane is a broken line: 8 marks of
 * 16 inches, evenly spaced, as painted on high-school courts.
 */
const FREE_THROW_DASHES = 8;
const FREE_THROW_DASH = feetToSvg(16 / 12);

function freeThrowDashArray(): string {
  const halfCircle = Math.PI * feetToSvg(FREE_THROW_CIRCLE_RADIUS);
  const gap = (halfCircle - FREE_THROW_DASHES * FREE_THROW_DASH) / (FREE_THROW_DASHES - 1);
  return `${FREE_THROW_DASH.toFixed(2)} ${gap.toFixed(2)}`;
}

/** A half circle around `center`, end to end across it, bulging toward half court or the baseline. */
function halfCircle(
  center: { x: number; y: number },
  radius: number,
  toward: 'halfCourt' | 'baseline',
) {
  // In SVG, y points down: sweeping clockwise from the left end passes over the top (the baseline).
  const sweep = toward === 'baseline' ? 1 : 0;
  return `M ${center.x - radius} ${center.y} A ${radius} ${radius} 0 0 ${sweep} ${center.x + radius} ${center.y}`;
}

const laneTopLeft = courtToSvg({ x: -LANE_WIDTH / 2, y: BASELINE_Y });
const laneBottomRight = courtToSvg({ x: LANE_WIDTH / 2, y: FREE_THROW_LINE_Y });
const lane = {
  x: laneTopLeft.x,
  y: laneTopLeft.y,
  width: laneBottomRight.x - laneTopLeft.x,
  height: laneBottomRight.y - laneTopLeft.y,
};

const freeThrowCenter = courtToSvg({ x: BASKET.x, y: FREE_THROW_LINE_Y });
const freeThrowRadius = feetToSvg(FREE_THROW_CIRCLE_RADIUS);

const basket = courtToSvg(BASKET);
const rimRadius = feetToSvg(RIM_RADIUS);
const backboardLeft = courtToSvg({ x: -BACKBOARD_WIDTH / 2, y: BACKBOARD_Y });
const backboardRight = courtToSvg({ x: BACKBOARD_WIDTH / 2, y: BACKBOARD_Y });

// The three-point line: straight down each corner from the baseline, then the arc
// around the basket (a half circle, since the corner lines end level with the basket).
const cornerLeftBase = courtToSvg({ x: -THREE_POINT_CORNER_X, y: BASELINE_Y });
const cornerLeftTop = courtToSvg({ x: -THREE_POINT_CORNER_X, y: THREE_POINT_CORNER_TOP_Y });
const cornerRightTop = courtToSvg({ x: THREE_POINT_CORNER_X, y: THREE_POINT_CORNER_TOP_Y });
const cornerRightBase = courtToSvg({ x: THREE_POINT_CORNER_X, y: BASELINE_Y });
const threePointRadius = feetToSvg(THREE_POINT_RADIUS);
const threePointLine = [
  `M ${cornerLeftBase.x} ${cornerLeftBase.y}`,
  `L ${cornerLeftTop.x} ${cornerLeftTop.y}`,
  `A ${threePointRadius} ${threePointRadius} 0 0 0 ${cornerRightTop.x} ${cornerRightTop.y}`,
  `L ${cornerRightBase.x} ${cornerRightBase.y}`,
].join(' ');

const centerCircle = halfCircle(
  courtToSvg({ x: BASKET.x, y: HALF_COURT_LINE_Y }),
  feetToSvg(CENTER_CIRCLE_RADIUS),
  'baseline',
);

// The drawing never changes, so it's built once and React skips it on every re-render.
const courtDrawing = (
  <>
    <rect
      className={styles.floor}
      x={COURT_VIEW_BOX.x}
      y={COURT_VIEW_BOX.y}
      width={COURT_VIEW_BOX.width}
      height={COURT_VIEW_BOX.height}
    />
    <rect className={styles.paint} {...lane} />
    <g className={styles.lines} strokeWidth={LINE_WIDTH} fill="none">
      {/* Baseline, sidelines and the half-court line. */}
      <rect x={0} y={0} width={COURT_SVG_WIDTH} height={COURT_SVG_HEIGHT} />
      <rect {...lane} />
      <path d={halfCircle(freeThrowCenter, freeThrowRadius, 'halfCourt')} />
      <path
        d={halfCircle(freeThrowCenter, freeThrowRadius, 'baseline')}
        strokeDasharray={freeThrowDashArray()}
      />
      <path d={threePointLine} />
      <path d={centerCircle} />
      <line
        x1={backboardLeft.x}
        y1={backboardLeft.y}
        x2={backboardRight.x}
        y2={backboardRight.y}
        strokeWidth={BACKBOARD_LINE_WIDTH}
      />
      {/* The bracket from the backboard to the back of the rim. */}
      <line x1={basket.x} y1={backboardLeft.y} x2={basket.x} y2={basket.y - rimRadius} />
    </g>
    <circle
      className={styles.rim}
      cx={basket.x}
      cy={basket.y}
      r={rimRadius}
      strokeWidth={LINE_WIDTH}
    />
  </>
);

export type HalfCourtProps = Omit<ComponentPropsWithRef<'svg'>, 'viewBox' | 'children'> & {
  /**
   * Drawn over the court, e.g. shot markers. Place them in SVG units with
   * `courtToSvg` (courtGeometry.ts).
   */
  children?: ReactNode;
};

/**
 * A high-school half court drawn to scale in SVG (from src/lib/court.ts), baseline
 * at the top. It fills the width it's given and keeps its proportions. It's an
 * image for screen readers: give it an `aria-label` that says what it shows.
 */
export function HalfCourt({
  children,
  className,
  role = 'img',
  'aria-label': ariaLabel = 'Basketball half court',
  ...props
}: HalfCourtProps) {
  return (
    <svg
      viewBox={COURT_VIEW_BOX_ATTRIBUTE}
      preserveAspectRatio="xMidYMid meet"
      // The CSS sizes it to the available width; these give every browser its proportions.
      width={COURT_VIEW_BOX.width}
      height={COURT_VIEW_BOX.height}
      role={role}
      aria-label={ariaLabel}
      focusable="false"
      className={cx(styles.court, className)}
      {...props}
    >
      {courtDrawing}
      {children}
    </svg>
  );
}
