import { useRef, type PointerEvent, type TouchEvent } from 'react';
import type { Shot } from '@/data/shots';
import type { CourtPoint } from '@/data/types';
import { clampToHalfCourt } from '@/lib/court';
import { cx } from '@/lib/cx';
import { clientToCourt, courtToSvg, courtViewBox, isOverBox, type ViewBox } from './courtGeometry';
import styles from './CourtPicker.module.css';
import { HalfCourt } from './HalfCourt';
import { describeSpot, shotValueLabel } from './shotLabels';
import { ShotMarkers } from './ShotMarkers';

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

/**
 * Where the marker is drawn: on the spot, except that a spot right by an edge of the
 * drawing is nudged inward (up to a foot) so the whole marker stays inside it.
 */
function markerPosition(point: CourtPoint, view: ViewBox) {
  const { x, y } = courtToSvg(clampToHalfCourt(point));
  const extent = MARKER_RADIUS + MARKER_HALO_WIDTH / 2;
  return {
    x: clamp(x, view.x + extent, view.x + view.width - extent),
    y: clamp(y, view.y + extent, view.y + view.height - extent),
  };
}

/** Where the label goes: right of the marker, or left of it near the right sideline. */
function labelPosition(marker: { x: number; y: number }, view: ViewBox) {
  const right = marker.x + MARKER_RADIUS + LABEL_GAP;
  const x =
    right + LABEL_WIDTH <= view.x + view.width - LABEL_INSET
      ? right
      : marker.x - MARKER_RADIUS - LABEL_GAP - LABEL_WIDTH;
  const y = clamp(
    marker.y - LABEL_HEIGHT / 2,
    view.y + LABEL_INSET,
    view.y + view.height - LABEL_INSET - LABEL_HEIGHT,
  );
  return { x, y };
}

interface PickedSpotProps {
  point: CourtPoint;
  /** What the shot was recorded as, if known (else it goes by where the spot is). */
  points: 2 | 3 | undefined;
  view: ViewBox;
}

/** The picked spot: a target ring with a "2PT"/"3PT" label beside it. */
function PickedSpot({ point, points, view }: PickedSpotProps) {
  const marker = markerPosition(point, view);
  const label = labelPosition(marker, view);
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
          {shotValueLabel(point, points)}
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
   * The spot picked for the shot being recorded, shown with a marker and its value
   * ("2PT" or "3PT"). null or undefined shows no marker.
   */
  pending?: CourtPoint | null;
  /**
   * What the shot being recorded is worth, when it's known already (e.g. from the 2PT
   * or 3PT button tapped): the picked spot is labeled (and described) with it, wherever
   * it is. Left out, the value is the spot's: 3PT beyond the arc.
   */
  pendingPoints?: 2 | 3;
  /** This game's earlier shots, drawn faintly for context (those with a location). */
  shots?: readonly Shot[];
  /**
   * How far from the baseline to show, in feet: the whole half court (42) by default.
   * Less crops the far end, e.g. 30 to leave room for buttons below.
   */
  depth?: number;
  /**
   * How the court takes touches. `'manipulation'` (the default) lets a drag that starts
   * on the court scroll the page, which cancels the tap. `'none'` keeps every touch a
   * tap even if the finger drifts, picking where it lifts: for a screen that doesn't
   * scroll, such as the live game screen.
   */
  touchAction?: 'manipulation' | 'none';
  /** What the court is for; the picked spot (or a tap hint) is added to it. */
  'aria-label'?: string;
  className?: string;
}

/**
 * A half court to tap where a shot was taken, for the live game screen. Tapping calls
 * `onPick`; the parent keeps the spot and passes it back as `pending`. It works with
 * touch, mouse and pen, even while other fingers are down elsewhere; it never zooms on
 * a double tap, never takes focus, and its tap never clicks what appears under the
 * finger. A shot's location is optional, so screen readers get an image with a
 * description rather than a control (and keyboards are never trapped in it).
 */
export function CourtPicker({
  onPick,
  pending,
  pendingPoints,
  shots,
  depth,
  touchAction = 'manipulation',
  'aria-label': ariaLabel = 'Shot location',
  className,
}: CourtPickerProps) {
  // The pointer whose tap is in progress: a tap is a press and a release on the court.
  const activePointer = useRef<number | null>(null);
  const view = courtViewBox(depth);

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // Any finger or pen, or the main mouse button. The latest press on the court wins,
    // even with other fingers down elsewhere (fast two-thumb entry).
    if (event.button !== 0) return;
    // No compatibility mouse events, so focus stays where it was and no text gets selected.
    event.preventDefault();
    activePointer.current = event.pointerId;
    try {
      // Hear about the release even off the court (e.g. a mouse dragged away).
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Not a live pointer (a synthetic event): its release is still heard on the court.
    }
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    const svg = event.currentTarget;
    // Released off the court: not a tap.
    if (!isOverBox(svg, event.clientX, event.clientY)) return;
    const point = clientToCourt(svg, event.clientX, event.clientY);
    if (point) onPick(point);
  };

  // The browser took the touch over (e.g. to scroll the page), or the pointer went
  // away: whatever happens next, it's not a tap.
  const handlePointerGone = (event: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current === event.pointerId) activePointer.current = null;
  };

  // The tap is taken on pointerup, so the click that follows it must not land on
  // whatever onPick puts under the finger (e.g. Made and Missed buttons).
  const handleTouchEnd = (event: TouchEvent<SVGSVGElement>) => {
    event.preventDefault();
  };

  const label = /[.?!]$/.test(ariaLabel) ? ariaLabel : `${ariaLabel}.`;
  const status = pending
    ? `Picked: ${describeSpot(pending, pendingPoints)}.`
    : 'Tap where the shot was taken.';

  return (
    <HalfCourt
      depth={depth}
      aria-label={`${label} ${status}`}
      className={cx(
        styles.picker,
        touchAction === 'none' ? styles.touchNone : styles.touchManipulation,
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerGone}
      onLostPointerCapture={handlePointerGone}
      onTouchEnd={handleTouchEnd}
    >
      {shots && shots.length > 0 ? <ShotMarkers shots={shots} faint /> : null}
      {pending ? (
        <PickedSpot
          key={`${pending.x},${pending.y}`}
          point={pending}
          points={pendingPoints}
          view={view}
        />
      ) : null}
    </HalfCourt>
  );
}
