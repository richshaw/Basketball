import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link } from 'react-router';
import { ChevronRightIcon } from '@/components/Icons/Icons';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/SegmentedControl/SegmentedControl';
import type { GameStatLine, StatLine } from '@/data/stats';
import { cx } from '@/lib/cx';
import { formatAvg, formatGameDate } from '@/lib/format';
import { paths } from '@/routes';
import { barLayout, columnPath, niceAxis, scaleY, slotIndexAt } from './chartScale';
import { formatDateRange, formatGameCount, formatResult, opponentLabel } from './gameLabels';
import { readSessionValue, writeSessionValue } from './seasonFilter';
import {
  describePoint,
  describeTrend,
  highestPoint,
  isTrendMetric,
  TREND_METRIC_INFO,
  TREND_METRICS,
  trendPoints,
  type TrendMetric,
  type TrendPoint,
} from './trendData';
import styles from './TrendChart.module.css';

// Chart geometry, in CSS px. The SVG is drawn at the width it's shown at, so text
// stays true to size on every phone.
const HEIGHT = 196;
/** Room above the plot for the value label on the tallest bar. */
const PAD_TOP = 22;
/** The band under the baseline for the first and last game dates. */
const X_AXIS_HEIGHT = 26;
/** Room right of the plot for the tick labels and the average's label. */
const GUTTER = 32;
const TICK_GAP = 8;
/** Tick labels this close (px) to the average's label are hidden so they never overlap. */
const AVG_LABEL_CLEARANCE = 16;
const VALUE_LABEL_GAP = 6;
/** Height of the mark drawn for a game with zero, so the game still shows. */
const ZERO_MARK_HEIGHT = 2;
/** Width before the chart has been measured (and in tests, which have no layout). */
const FALLBACK_WIDTH = 320;
/**
 * Focus arriving this soon (ms) after a press on the chart came from that press (some
 * browsers focus a tapped button), not from the keyboard.
 */
const POINTER_FOCUS_WINDOW_MS = 1000;
/** How far (px) a press has to slide sideways before it scrubs instead of tapping. */
const SCRUB_THRESHOLD = 6;

const METRIC_OPTIONS: SegmentedOption<TrendMetric>[] = TREND_METRICS.map((metric) => ({
  value: metric,
  label: TREND_METRIC_INFO[metric].label,
}));

/** Centers a 1px line on the pixel grid so it stays crisp. */
const crisp = (value: number) => Math.round(value) + 0.5;

/** The element's width, kept up to date as it resizes. */
function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(measured);
    };
    // Measure before the first paint, then follow resizes (rotation, split view).
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function readRememberedMetric(): TrendMetric {
  const stored = readSessionValue('metric');
  return isTrendMetric(stored) ? stored : 'pts';
}

export interface TrendChartProps {
  /** The games to chart, oldest first, each with its stat line. */
  entries: readonly GameStatLine[];
  /** Per-game averages over the same games (from summarizeGames). */
  averages: StatLine;
  /** Show the dates' years (the games span more than one year). */
  withYear: boolean;
}

/**
 * Points (or rebounds, or assists) game by game: one bar per game, oldest on the
 * left, with the average as a line across them. Tap or drag across the bars to read
 * one game; the arrow keys do the same. Every value is also in the game log.
 */
export function TrendChart({ entries, averages, withYear }: TrendChartProps) {
  const [metric, setMetric] = useState<TrendMetric>(readRememberedMetric);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { ref: plotRef, width } = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const hitAreaRef = useRef<HTMLDivElement>(null);
  const hitRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** The pointer pressing on the chart: where it started and whether it's scrubbing. */
  const press = useRef<{
    pointerId: number;
    startX: number;
    index: number;
    scrubbing: boolean;
  } | null>(null);
  /** When the chart was last pressed or let go (an event timeStamp). */
  const lastPressAt = useRef(Number.NEGATIVE_INFINITY);
  const summaryId = useId();

  const info = TREND_METRIC_INFO[metric];
  const points = trendPoints(entries, metric);
  const average = averages[metric];
  const high = highestPoint(points);
  const selectedIndex = points.findIndex((point) => point.game.id === selectedId);
  const selected = points[selectedIndex];
  const first = points[0];
  const last = points.at(-1);
  /** A short date for the axis: 'Aug 1', or 'Aug 1, 2025' when the games span years. */
  const axisDate = (point: TrendPoint) =>
    formatGameDate(point.game.date, { withYear, weekday: false });

  // Scales
  const plotWidth = Math.max(width - GUTTER, 0);
  const baseline = HEIGHT - X_AXIS_HEIGHT;
  const plotHeight = baseline - PAD_TOP;
  const axis = niceAxis(Math.max(high?.value ?? 0, average));
  const y = (value: number) => scaleY(value, axis.max, baseline, plotHeight);
  const avgY = y(average);
  const { slotWidth, barWidth, slots } = barLayout(points.length, 0, plotWidth);

  const chooseMetric = (next: TrendMetric) => {
    setMetric(next);
    writeSessionValue('metric', next);
  };

  const select = (index: number | null) => {
    setSelectedId(index === null ? null : (points[index]?.game.id ?? null));
  };

  // Pointer: tap a bar to read it (tap it again to let go) or slide sideways to scrub.
  // A vertical swipe scrolls the page (the browser cancels the press) and selects nothing.
  const indexAtPointer = (event: ReactPointerEvent<HTMLElement>): number | null => {
    const rect = hitAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return slotIndexAt(event.clientX - rect.left, rect.width, points.length);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const bar = event.target instanceof Element ? event.target.closest('[data-index]') : null;
    const index = bar ? Number(bar.getAttribute('data-index')) : indexAtPointer(event);
    if (index === null || Number.isNaN(index)) return;
    lastPressAt.current = event.timeStamp;
    press.current = { pointerId: event.pointerId, startX: event.clientX, index, scrubbing: false };
    if (event.pointerType === 'mouse') {
      // Keep scrubbing when the mouse leaves the chart mid-drag.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Not supported: scrubbing just stops at the chart's edge.
      }
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.scrubbing) {
      if (Math.abs(event.clientX - current.startX) < SCRUB_THRESHOLD) return;
      current.scrubbing = true;
    }
    const index = indexAtPointer(event);
    if (index !== null && index !== selectedIndex) select(index);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    lastPressAt.current = event.timeStamp;
    // A tap toggles the bar it landed on; a scrub leaves the last game it reached selected.
    if (!current.scrubbing) select(current.index === selectedIndex ? null : current.index);
  };

  // Keyboard focus reads the game, like a tap does. A tap already selected on press, and
  // the focus some browsers then give the tapped button must not undo a tap-to-clear.
  const handleFocus = (index: number, event: FocusEvent) => {
    const fromPress = event.timeStamp - lastPressAt.current < POINTER_FOCUS_WINDOW_MS;
    if (!press.current && !fromPress) select(index);
  };

  const handlePointerCancel = () => {
    press.current = null;
  };

  // Keyboard: one tab stop; the arrow keys (and Home/End) move between games.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = hitRefs.current.findIndex((button) => button === event.target);
    if (current === -1) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = Math.min(current + 1, points.length - 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = Math.max(current - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = points.length - 1;
        break;
      case 'Escape':
        if (selected) {
          event.preventDefault();
          select(null);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    hitRefs.current[next]?.focus();
    select(next);
  };

  const tabStop = selectedIndex === -1 ? points.length - 1 : selectedIndex;
  // Direct labels only where they help: the high, and the game being read.
  const labelled = [high, selected].filter(
    (point, index, all): point is TrendPoint =>
      point !== undefined && point.value > 0 && all.indexOf(point) === index,
  );
  const result = selected ? formatResult(selected.game) : null;

  return (
    <div className={styles.chart}>
      <SegmentedControl
        aria-label="Stat to chart"
        options={METRIC_OPTIONS}
        value={metric}
        onChange={chooseMetric}
      />

      <div className={styles.readout}>
        <div className={styles.readoutText}>
          <p className={styles.readoutLabel}>
            {selected ? formatGameDate(selected.game.date, { withYear }) : 'Average'}
          </p>
          <p className={styles.readoutFigure}>
            <span className={styles.readoutValue}>
              {selected ? selected.value : formatAvg(average)}
            </span>{' '}
            <span className={styles.readoutUnit}>
              {selected ? info.unit(selected.value) : `${info.label.toLowerCase()} per game`}
            </span>
          </p>
          <p className={styles.readoutMeta}>
            {selected
              ? [opponentLabel(selected.game), result].filter(Boolean).join(' · ')
              : first && last
                ? `${formatGameCount(points.length)} · ${formatDateRange(first.game.date, last.game.date, { withYear })}`
                : formatGameCount(0)}
          </p>
        </div>
        {selected ? (
          <Link
            to={paths.gameReport(selected.game.id)}
            className={styles.readoutLink}
            aria-label={`Game report, ${opponentLabel(selected.game)}, ${formatGameDate(selected.game.date, { withYear })}`}
          >
            Game report
            <ChevronRightIcon className={styles.readoutChevron} />
          </Link>
        ) : null}
        <span id={summaryId} className="visually-hidden">
          {describeTrend(points, metric, averages, { withYear })}
        </span>
      </div>

      <div ref={plotRef} className={styles.plot}>
        <svg
          className={styles.svg}
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          aria-hidden="true"
          focusable="false"
        >
          {axis.ticks.map((tick) => (
            <g key={tick}>
              {tick > 0 ? (
                <line
                  className={styles.gridline}
                  x1={0}
                  x2={plotWidth}
                  y1={crisp(y(tick))}
                  y2={crisp(y(tick))}
                />
              ) : null}
              {Math.abs(y(tick) - avgY) >= AVG_LABEL_CLEARANCE ? (
                <text className={styles.tick} x={plotWidth + TICK_GAP} y={y(tick)} dy="0.35em">
                  {tick}
                </text>
              ) : null}
            </g>
          ))}

          {selected && slots[selectedIndex] ? (
            <rect
              className={styles.column}
              x={slots[selectedIndex].slotX + 1}
              y={PAD_TOP - 8}
              width={Math.max(slotWidth - 2, 1)}
              height={baseline - PAD_TOP + 8}
              rx={Math.min(6, slotWidth / 2)}
            />
          ) : null}

          {points.map((point, index) => {
            const slot = slots[index];
            if (!slot) return null;
            const className = cx(
              point.value > 0 ? styles.bar : styles.zeroMark,
              selected && index !== selectedIndex && styles.dimmed,
            );
            return point.value > 0 ? (
              <path
                key={point.game.id}
                className={className}
                d={columnPath(slot.barX, y(point.value), barWidth, baseline)}
              />
            ) : (
              <rect
                key={point.game.id}
                className={className}
                x={slot.barX}
                y={baseline - ZERO_MARK_HEIGHT}
                width={barWidth}
                height={ZERO_MARK_HEIGHT}
                rx={Math.min(1, barWidth / 2)}
              />
            );
          })}

          <line
            className={styles.baseline}
            x1={0}
            x2={plotWidth}
            y1={crisp(baseline)}
            y2={crisp(baseline)}
          />

          <line className={styles.avgHalo} x1={0} x2={plotWidth} y1={avgY} y2={avgY} />
          <line className={styles.avgLine} x1={1} x2={plotWidth - 1} y1={avgY} y2={avgY} />
          <text className={styles.avgLabel} x={plotWidth + TICK_GAP} y={avgY} dy="0.35em">
            avg
          </text>

          {labelled.map((point) => {
            const index = points.indexOf(point);
            const slot = slots[index];
            return slot ? (
              <text
                key={point.game.id}
                className={cx(styles.valueLabel, index === selectedIndex && styles.onColumn)}
                x={slot.center}
                y={y(point.value) - VALUE_LABEL_GAP}
                textAnchor="middle"
              >
                {point.value}
              </text>
            ) : null;
          })}

          {first && last && slots[0] ? (
            points.length === 1 ? (
              <text
                className={styles.dateLabel}
                x={slots[0].center}
                y={HEIGHT - 6}
                textAnchor="middle"
              >
                {axisDate(first)}
              </text>
            ) : (
              <>
                <text className={styles.dateLabel} x={0} y={HEIGHT - 6}>
                  {axisDate(first)}
                </text>
                <text className={styles.dateLabel} x={plotWidth} y={HEIGHT - 6} textAnchor="end">
                  {axisDate(last)}
                </text>
              </>
            )
          ) : null}
        </svg>

        {/* Hit targets: a full-height column per game, bigger than the bar it reads. */}
        <div
          ref={hitAreaRef}
          role="group"
          aria-label={`${info.label} by game`}
          aria-describedby={summaryId}
          className={styles.hitArea}
          style={{ width: plotWidth, height: HEIGHT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onKeyDown={handleKeyDown}
        >
          {points.map((point, index) => (
            <button
              key={point.game.id}
              ref={(button) => {
                hitRefs.current[index] = button;
              }}
              type="button"
              className={styles.hit}
              data-index={index}
              tabIndex={index === tabStop ? 0 : -1}
              aria-pressed={index === selectedIndex}
              aria-label={describePoint(point, metric, { withYear })}
              onFocus={(event) => handleFocus(index, event)}
              onClick={(event) => {
                // Enter or Space (detail 0) toggles; pointer taps are handled on press.
                if (event.detail === 0) select(index === selectedIndex ? null : index);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
