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
  courtToSvg,
  courtViewBox,
  feetToSvg,
  viewBoxAttribute,
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

// The lines never change, so they're built once and React skips them on every re-render.
// A shallower view box just cuts them off.
const courtDrawing = (
  <>
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

export type HalfCourtProps = Omit<
  ComponentPropsWithRef<'svg'>,
  'viewBox' | 'width' | 'height' | 'children'
> & {
  /**
   * How far from the baseline to show, in feet: the whole half court (42) by default.
   * Less crops the far end (see `courtViewBox`), e.g. 30 to leave room for buttons.
   */
  depth?: number;
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
  depth,
  children,
  className,
  role = 'img',
  'aria-label': ariaLabel = 'Basketball half court',
  ...props
}: HalfCourtProps) {
  const viewBox = courtViewBox(depth);
  return (
    <svg
      viewBox={viewBoxAttribute(viewBox)}
      preserveAspectRatio="xMidYMid meet"
      // The CSS sizes it to the available width; these give every browser its proportions.
      width={viewBox.width}
      height={viewBox.height}
      role={role}
      aria-label={ariaLabel}
      focusable="false"
      className={cx(styles.court, className)}
      {...props}
    >
      <rect className={styles.floor} {...viewBox} />
      {courtDrawing}
      {children}
    </svg>
  );
}
