import type { ReactElement } from 'react';
import { hasLocation, type Shot } from '@/data/shots';
import { clampToHalfCourt, isInPaint } from '@/lib/court';
import { cx } from '@/lib/cx';
import { courtToSvg } from './courtGeometry';
import styles from './ShotMarkers.module.css';

/**
 * Marker sizes in SVG units (10 per foot). About 9px across on a phone-wide court:
 * easy to spot, yet small enough that a season of shots stays readable.
 */
const MADE_RADIUS = 6.25;
const MISS_HALF_WIDTH = 5;
const MISS_LINE_WIDTH = 2.4;
/** The ring (makes) and halo (misses) of floor color show this far beyond a marker. */
const SEPARATION = 1.25;
const MISS_PATH = [
  `M ${-MISS_HALF_WIDTH} ${-MISS_HALF_WIDTH} L ${MISS_HALF_WIDTH} ${MISS_HALF_WIDTH}`,
  `M ${-MISS_HALF_WIDTH} ${MISS_HALF_WIDTH} L ${MISS_HALF_WIDTH} ${-MISS_HALF_WIDTH}`,
].join(' ');
/** Room around a single marker, for a legend glyph. */
const GLYPH_EXTENT = 8;

interface MarkerProps {
  x: number;
  y: number;
  /** In the lane: the ring or halo takes the lane's color, so only overlaps show it. */
  onPaint?: boolean;
}

function MadeMarker({ x, y, onPaint = false }: MarkerProps) {
  // The ring is a stroke painted under the fill, so only its outer half shows.
  return (
    <circle
      className={cx(styles.made, onPaint && styles.onPaint)}
      cx={x}
      cy={y}
      r={MADE_RADIUS}
      strokeWidth={2 * SEPARATION}
    />
  );
}

function MissMarker({ x, y, onPaint = false }: MarkerProps) {
  return (
    <g className={cx(styles.miss, onPaint && styles.onPaint)} transform={`translate(${x} ${y})`}>
      <path
        className={styles.missHalo}
        d={MISS_PATH}
        strokeWidth={MISS_LINE_WIDTH + 2 * SEPARATION}
      />
      <path className={styles.missMark} d={MISS_PATH} strokeWidth={MISS_LINE_WIDTH} />
    </g>
  );
}

export interface ShotMarkersProps {
  /** Shots without a location are left out. */
  shots: readonly Shot[];
  /** Draws them faded, as context behind something else (e.g. earlier shots). */
  faint?: boolean;
}

/**
 * Shot markers for a HalfCourt: a filled circle for a make, an × for a miss. Makes
 * are drawn first, so the thinner ×s stay visible where markers overlap.
 */
export function ShotMarkers({ shots, faint = false }: ShotMarkersProps) {
  const made: ReactElement[] = [];
  const missed: ReactElement[] = [];
  shots.forEach((shot, index) => {
    if (!hasLocation(shot)) return;
    const location = clampToHalfCourt(shot.location);
    const { x, y } = courtToSvg(location);
    const onPaint = isInPaint(location);
    if (shot.made) made.push(<MadeMarker key={index} x={x} y={y} onPaint={onPaint} />);
    else missed.push(<MissMarker key={index} x={x} y={y} onPaint={onPaint} />);
  });
  return (
    <g className={cx(styles.markers, faint && styles.faint)}>
      {made}
      {missed}
    </g>
  );
}

/** One marker on its own, e.g. as the key in a legend. Hidden from screen readers. */
export function ShotGlyph({ made, className }: { made: boolean; className?: string }) {
  return (
    <svg
      viewBox={`${-GLYPH_EXTENT} ${-GLYPH_EXTENT} ${2 * GLYPH_EXTENT} ${2 * GLYPH_EXTENT}`}
      aria-hidden="true"
      focusable="false"
      className={cx(styles.glyph, className)}
    >
      {made ? <MadeMarker x={0} y={0} /> : <MissMarker x={0} y={0} />}
    </svg>
  );
}
