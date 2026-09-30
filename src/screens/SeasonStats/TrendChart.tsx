import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
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
import { gameTitle } from '@/lib/gameTitle';
import { formatDateRange, formatGameCount, formatResult } from './gameLabels';
import { fitsSegments, readSessionValue, writeSessionValue } from './seasonFilter';
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
 * Focus or a click arriving this soon (ms) after a press on the chart came from that
 * press (browsers focus a tapped button, and may click at the end of a short drag).
 */
const PRESS_FOLLOW_UP_MS = 1000;
/**
 * How far (px) a press has to move to be a drag rather than a tap: sideways it scrubs
 * through the games; up or down it's the page scrolling.
 */
const DRAG_THRESHOLD = 6;

/** The stats to chart, by name: 'Points', 'Rebounds', 'Assists'. */
const METRIC_OPTIONS: SegmentedOption<TrendMetric>[] = TREND_METRICS.map((metric) => ({
  value: metric,
  label: TREND_METRIC_INFO[metric].label,
}));
/** The same where their names don't fit ('PTS', 'REB', 'AST'), named in full to screen readers. */
const SHORT_METRIC_OPTIONS: SegmentedOption<TrendMetric>[] = TREND_METRICS.map((metric) => ({
  value: metric,
  label: TREND_METRIC_INFO[metric].short,
  fullLabel: TREND_METRIC_INFO[metric].label,
}));
/** The names fit together by their length (as the season picker checks its own). */
const METRIC_NAMES_FIT = fitsSegments(METRIC_OPTIONS.map((option) => option.label));

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
  // The names turned out not to fit the control (page zoom, say): the short labels then,
  // while the screen is open, rather than names cut short.
  const [namesOverflowed, setNamesOverflowed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { ref: plotRef, width } = useElementWidth<HTMLDivElement>(FALLBACK_WIDTH);
  const hitAreaRef = useRef<HTMLDivElement>(null);
  const hitRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** The pointer pressing on the chart: where it started and whether it's scrubbing. */
  const press = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrubbing: boolean;
  } | null>(null);
  /** When the chart was last pressed or let go (an event timeStamp). */
  const lastPressAt = useRef(Number.NEGATIVE_INFINITY);
  /** When the last scrub ended (an event timeStamp): the click that can follow isn't a tap. */
  const scrubEndedAt = useRef(Number.NEGATIVE_INFINITY);
  const summaryId = useId();
  const columnClipId = useId();

  const info = TREND_METRIC_INFO[metric];
  // The points and their text change with the games or the stat, not on each scrub step.
  const { points, high, labels } = useMemo(() => {
    const list = trendPoints(entries, metric);
    return {
      points: list,
      high: highestPoint(list),
      labels: list.map((point) => describePoint(point, metric, { withYear })),
    };
  }, [entries, metric, withYear]);
  const summary = useMemo(
    () => describeTrend(points, metric, averages, { withYear }),
    [points, metric, averages, withYear],
  );
  const average = averages[metric];
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

  // Selecting: every way of pressing a bar (a tap, a click, Enter or Space, a screen
  // reader's double tap) ends in exactly one click, so a bar is read or let go only in
  // handleClick. Pointer events only scrub: sliding sideways reads each game on the way.
  const indexAtPointer = (event: ReactPointerEvent<HTMLElement>): number | null => {
    const rect = hitAreaRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return null;
    return slotIndexAt(event.clientX - rect.left, rect.width, points.length);
  };

  const handleClick = (index: number, event: MouseEvent) => {
    // A browser may click at the end of a short scrub: that press already chose its game.
    const endsScrub =
      event.detail !== 0 && event.timeStamp - scrubEndedAt.current < PRESS_FOLLOW_UP_MS;
    scrubEndedAt.current = Number.NEGATIVE_INFINITY;
    if (!endsScrub) select(index === selectedIndex ? null : index);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    lastPressAt.current = event.timeStamp;
    scrubEndedAt.current = Number.NEGATIVE_INFINITY;
    press.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrubbing: false,
    };
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
      const dx = Math.abs(event.clientX - current.startX);
      const dy = Math.abs(event.clientY - current.startY);
      if (dx >= DRAG_THRESHOLD && dx > dy) {
        current.scrubbing = true;
      } else {
        // Mostly up or down: that's the page scrolling, so let the press go.
        if (dy >= DRAG_THRESHOLD) press.current = null;
        return;
      }
    }
    const index = indexAtPointer(event);
    if (index !== null && index !== selectedIndex) select(index);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current || current.pointerId !== event.pointerId) return;
    press.current = null;
    lastPressAt.current = event.timeStamp;
    // A scrub leaves the last game it reached selected.
    if (current.scrubbing) scrubEndedAt.current = event.timeStamp;
  };

  // The browser took the press over (e.g. to scroll): it was neither a tap nor a scrub.
  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (press.current?.pointerId === event.pointerId) press.current = null;
  };

  // Keyboard focus reads the game. The focus a press gives the button it landed on
  // doesn't: that press's click decides, and must not be undone by it.
  const handleFocus = (index: number, event: FocusEvent) => {
    const fromPress = event.timeStamp - lastPressAt.current < PRESS_FOLLOW_UP_MS;
    if (!press.current && !fromPress) select(index);
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
  // The readout's last line: the game's matchup (its result follows), or the games charted.
  let metaText = formatGameCount(0);
  if (selected) {
    metaText = gameTitle(selected.game);
  } else if (first && last) {
    const dates = formatDateRange(first.game.date, last.game.date, { withYear });
    metaText = `${formatGameCount(points.length)} · ${dates}`;
  }
  // The selected game's column, a band behind its bar from the top of the plot down.
  const selectedSlot = slots[selectedIndex];
  const column = selectedSlot
    ? {
        x: selectedSlot.slotX + 1,
        y: PAD_TOP - 8,
        width: Math.max(slotWidth - 2, 1),
        height: baseline - PAD_TOP + 8,
        rx: Math.min(6, slotWidth / 2),
      }
    : null;

  return (
    <div className={styles.chart}>
      {/*
        "Rebounds", bold when picked, takes the room it needs from the shorter two. If the
        names need more room than the control has, it says so (onOverflow): then PTS,
        REB and AST.
      */}
      <SegmentedControl
        aria-label="Stat to chart"
        options={METRIC_NAMES_FIT && !namesOverflowed ? METRIC_OPTIONS : SHORT_METRIC_OPTIONS}
        value={metric}
        onChange={chooseMetric}
        fitLabels
        onOverflow={() => setNamesOverflowed(true)}
      />

      {/*
        The date and the number on the left, "Game report" beside them, and the game's
        matchup and result on a line of their own, the chart's whole width: the result
        always shows in full (a long opponent's name gives way), and the readout is as
        tall for a game as for the average, so the chart never moves under the finger.
      */}
      <div className={styles.readout}>
        <p className={styles.readoutLabel}>
          {selected ? formatGameDate(selected.game.date, { withYear }) : 'Average'}
        </p>
        <p className={styles.readoutFigure}>
          <span className={cx(styles.readoutValue, 'tabular-nums')}>
            {selected ? selected.value : formatAvg(average)}
          </span>{' '}
          <span className={styles.readoutUnit}>
            {selected ? info.unit(selected.value) : `${info.label.toLowerCase()} per game`}
          </span>
        </p>
        <p className={styles.readoutMeta}>
          <span className={styles.readoutMetaText}>{metaText}</span>
          {/* (A no-break space: a flex item drops the ordinary kind at its start.) */}
          {selected && result ? (
            <span className={styles.readoutResult}>{`\u00a0· ${result}`}</span>
          ) : null}
        </p>
        {selected ? (
          <Link
            to={paths.gameReport(selected.game.id)}
            className={styles.readoutLink}
            aria-label={`Game report, ${gameTitle(selected.game)}, ${formatGameDate(selected.game.date, { withYear })}`}
          >
            Game report
            <ChevronRightIcon className={styles.readoutChevron} />
          </Link>
        ) : null}
        <span id={summaryId} className="visually-hidden">
          {summary}
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

          {column ? (
            <>
              <defs>
                <clipPath id={columnClipId}>
                  <rect {...column} />
                </clipPath>
              </defs>
              <rect className={styles.column} {...column} />
            </>
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
          {column ? (
            // Across the selected column the halo takes the column's color, instead of
            // painting a band of the card's color through it.
            <line
              className={cx(styles.avgHalo, styles.onColumn)}
              clipPath={`url(#${columnClipId})`}
              x1={0}
              x2={plotWidth}
              y1={avgY}
              y2={avgY}
            />
          ) : null}
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
              tabIndex={index === tabStop ? 0 : -1}
              aria-pressed={index === selectedIndex}
              aria-label={labels[index]}
              onFocus={(event) => handleFocus(index, event)}
              onClick={(event) => handleClick(index, event)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
