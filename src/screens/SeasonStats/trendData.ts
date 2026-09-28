/** Data for the per-game trend chart: which stats it can show, its points and its text. */
import type { GameStatLine, StatLine } from '@/data/stats';
import type { Game } from '@/data/types';
import { formatAvg } from '@/lib/format';
import { formatDateRange, formatGameCount, formatShortDate, opponentLabel } from './gameLabels';

export const TREND_METRICS = ['pts', 'reb', 'ast'] as const;
export type TrendMetric = (typeof TREND_METRICS)[number];

export interface TrendMetricInfo {
  /** Segment label and chart name, e.g. 'Points'. */
  label: string;
  /** Unit after a number: '18 points', '1 point'. */
  unit: (value: number) => string;
}

export const TREND_METRIC_INFO: Record<TrendMetric, TrendMetricInfo> = {
  pts: { label: 'Points', unit: (value) => (value === 1 ? 'point' : 'points') },
  reb: { label: 'Rebounds', unit: (value) => (value === 1 ? 'rebound' : 'rebounds') },
  ast: { label: 'Assists', unit: (value) => (value === 1 ? 'assist' : 'assists') },
};

export function isTrendMetric(value: string | undefined): value is TrendMetric {
  return (TREND_METRICS as readonly string[]).includes(value ?? '');
}

export interface TrendPoint {
  game: Game;
  value: number;
}

/** One point per game, in the order given (the chart wants oldest first). */
export function trendPoints(entries: readonly GameStatLine[], metric: TrendMetric): TrendPoint[] {
  return entries.map(({ game, line }) => ({ game, value: line[metric] }));
}

/** What one bar says to a screen reader: 'Sep 12, vs Lincoln: 18 points'. */
export function describePoint({ game, value }: TrendPoint, metric: TrendMetric): string {
  return `${formatShortDate(game.date)}, ${opponentLabel(game)}: ${value} ${TREND_METRIC_INFO[metric].unit(value)}`;
}

/** The first game with the highest value (ties go to the earlier game, like season highs). */
export function highestPoint(points: readonly TrendPoint[]): TrendPoint | undefined {
  let best: TrendPoint | undefined;
  for (const point of points) if (!best || point.value > best.value) best = point;
  return best;
}

/** The first game with the lowest value. */
function lowestPoint(points: readonly TrendPoint[]): TrendPoint | undefined {
  let worst: TrendPoint | undefined;
  for (const point of points) if (!worst || point.value < worst.value) worst = point;
  return worst;
}

/**
 * A text summary of the chart, e.g. 'Points in 10 games, Aug 1 – Sep 24. Average 12.4
 * a game. High 18 vs Lincoln on Sep 12. Low 6 at Westview on Aug 22.'
 */
export function describeTrend(
  points: readonly TrendPoint[],
  metric: TrendMetric,
  averages: Pick<StatLine, TrendMetric>,
): string {
  const first = points[0];
  const last = points.at(-1);
  const high = highestPoint(points);
  const low = lowestPoint(points);
  if (!first || !last || !high || !low) return `${TREND_METRIC_INFO[metric].label}: no games yet.`;

  const sentences = [
    `${TREND_METRIC_INFO[metric].label} in ${formatGameCount(points.length)}, ${formatDateRange(first.game.date, last.game.date)}.`,
    `Average ${formatAvg(averages[metric])} a game.`,
  ];
  if (points.length > 1) {
    const at = (point: TrendPoint) =>
      `${point.value} ${opponentLabel(point.game)} on ${formatShortDate(point.game.date)}`;
    sentences.push(`High ${at(high)}.`, `Low ${at(low)}.`);
  }
  return sentences.join(' ');
}
