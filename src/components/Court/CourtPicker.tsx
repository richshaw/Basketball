import { useRef, type PointerEvent } from 'react';
import type { CourtPoint } from '@/data/types';
import { clampToHalfCourt } from '@/lib/court';
import { cx } from '@/lib/cx';
import { clientToCourt, COURT_VIEW_BOX, courtToSvg } from './courtGeometry';
import styles from './CourtPicker.module.css';
import { HalfCourt } from './HalfCourt';
import { ShotMarkers } from './ShotMarkers';
import { describeSpot, shotValueLabel, type Shot } from './shots';

// The picked-spot marker and its label, in SVG units (10 per foot).
const MARKER_RADIUS = 15;
const MARKER_RING_WIDTH = 4;
/** Floor-colored ring around the marker, so it stands clear of lines and shots. */
const MARKER_HALO_WIDTH = 10;
const MARKER_DOT_RADIUS = 3.5;
const LABEL_WIDTH = 64;
const LABEL_HEIGHT = 34;
const LABEL_FONT_SIZE = 21;
const LABEL_GAP = 6;
/** How far inside the drawing's edges the label stays. */
const LABEL_INSET = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const viewRight = COURT_VIEW_BOX.x + COURT_VIEW_BOX.width;
const viewBottom = COURT_VIEW_BOX.y + COURT_VIEW_BOX.height;

/**
 * Where the marker is drawn: on the spot, except that a spot right by the outer lines
 * is nudged inward (up to a foot) so the whole marker stays inside the drawing.
 */
function markerPosition(point: CourtPoint) {
  const { x, y } = courtToSvg(clampToHalfCourt(point));
  const extent = MARKER_RADIUS + MARKER_HALO_WIDTH / 2;
  return {
    x: clamp(x, COURT_VIEW_BOX.x + extent, viewRight - extent),
    y: clamp(y, COURT_VIEW_BOX.y + extent, viewBottom - extent),
  };
}

/** Where the label goes: right of the marker, or left of it near the right sideline. */
function labelPosition(marker: { x: number; y: number }) {
  const right = marker.x + MARKER_RADIUS + LABEL_GAP;
  const x =
    right + LABEL_WIDTH <= viewRight - LABEL_INSET
      ? right
      : marker.x - MARKER_RADIUS - LABEL_GAP - LABEL_WIDTH;
  const y = clamp(
    marker.y - LABEL_HEIGHT / 2,
    COURT_VIEW_BOX.y + LABEL_INSET,
    viewBottom - LABEL_INSET - LABEL_HEIGHT,
  );
  return { x, y };
}

/** The picked spot: a target ring with a "2PT"/"3PT" label beside it. */
function PickedSpot({ point }: { point: CourtPoint }) {
  const marker = markerPosition(point);
  const label = labelPosition(marker);
  return (
    <g className={styles.picked}>
      <g transform={`translate(${marker.x} ${marker.y})`}>
        <g className={styles.pop}>
          <circle className={styles.markerHalo} r={MARKER_RADIUS} strokeWidth={MARKER_HALO_WIDTH} />
          <circle className={styles.markerRing} r={MARKER_RADIUS} strokeWidth={MARKER_RING_WIDTH} />
          <circle className={styles.markerDot} r={MARKER_DOT_RADIUS} />
        </g>
      </g>
      <g className={styles.label} transform={`translate(${label.x} ${label.y})`}>
        <rect
          className={styles.labelPill}
          width={LABEL_WIDTH}
          height={LABEL_HEIGHT}
          rx={LABEL_HEIGHT / 2}
        />
        <text
          className={styles.labelText}
          x={LABEL_WIDTH / 2}
          y={LABEL_HEIGHT / 2}
          fontSize={LABEL_FONT_SIZE}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {shotValueLabel(point)}
        </text>
      </g>
    </g>
  );
}

export interface CourtPickerProps {
  /**
   * Called once per tap with the spot, in feet: rounded to a hundredth of a foot and
   * on the half court (a tap just outside a line lands on it).
   */
  onPick: (point: CourtPoint) => void;
  /**
   * The spot picked for the shot being recorded, shown with a marker and its
   * inferred value ("2PT" or "3PT"). null or undefined shows no marker.
   */
  pending?: CourtPoint | null;
  /** This game's earlier shots, drawn faintly for context. */
  shots?: readonly Shot[];
  /** What the court is for; the picked spot (or a tap hint) is added to it. */
  'aria-label'?: string;
  className?: string;
}

/**
 * A half court to tap where a shot was taken, for the live game screen. Tapping calls
 * `onPick`; the parent keeps the spot and passes it back as `pending`. It works with
 * touch, mouse and pen, never zooms on a double tap and never takes focus. A shot's
 * location is optional, so screen readers get an image with a description rather
 * than a control (and keyboards are never trapped in it).
 */
export function CourtPicker({
  onPick,
  pending,
  shots,
  'aria-label': ariaLabel = 'Shot location',
  className,
}: CourtPickerProps) {
  // The pointer whose tap is in progress: a tap is a press and a release on the court.
  const activePointer = useRef<number | null>(null);

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    // No compatibility mouse events, so focus stays where it was and no text gets selected.
    event.preventDefault();
    activePointer.current = event.pointerId;
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    const point = clientToCourt(event.currentTarget, event.clientX, event.clientY);
    if (point) onPick(point);
  };

  // The browser took the touch over (e.g. to scroll the page): not a tap.
  const handlePointerCancel = () => {
    activePointer.current = null;
  };

  const label = /[.?!]$/.test(ariaLabel) ? ariaLabel : `${ariaLabel}.`;
  const status = pending ? `Picked: ${describeSpot(pending)}.` : 'Tap where the shot was taken.';

  return (
    <HalfCourt
      aria-label={`${label} ${status}`}
      className={cx(styles.picker, className)}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {shots && shots.length > 0 ? <ShotMarkers shots={shots} faint /> : null}
      {pending ? <PickedSpot key={`${pending.x},${pending.y}`} point={pending} /> : null}
    </HalfCourt>
  );
}
