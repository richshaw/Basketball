/**
 * Geometry for the per-game trend chart (hand-rolled SVG). Pure functions, so the
 * scale and layout math is unit-tested without rendering anything.
 */

export interface ValueAxis {
  /** The top of the axis (the largest tick). Always > 0. */
  max: number;
  /** Tick values from 0 to `max`, evenly spaced. */
  ticks: number[];
}

/**
 * A clean y-axis from 0 to at least `maxValue`: whole-number steps of 1, 2 or 5 × 10ⁿ
 * (stats are counts), about `targetIntervals` of them. An empty or all-zero series
 * still gets an axis (0 to 1).
 */
export function niceAxis(maxValue: number, targetIntervals = 4): ValueAxis {
  const max = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const rough = max / targetIntervals;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  // Round the step to the nearest "nice" number (the thresholds are the geometric means).
  const nice =
    residual >= Math.sqrt(50) ? 10 : residual >= Math.sqrt(10) ? 5 : residual >= Math.SQRT2 ? 2 : 1;
  const step = Math.max(1, nice * magnitude);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = 0; tick <= top; tick += step) ticks.push(tick);
  return { max: top, ticks };
}

export interface BarSlot {
  /** Left edge of the slot (the whole column a bar owns, for hit areas). */
  slotX: number;
  /** Left edge of the bar, centered in its slot. */
  barX: number;
  /** Horizontal center of the slot. */
  center: number;
}

export interface BarLayout {
  slotWidth: number;
  barWidth: number;
  slots: BarSlot[];
}

export interface BarLayoutOptions {
  /** Bars never get thicker than this (px), however few there are. */
  maxBarWidth?: number;
  /** Share of each slot the bar fills; the rest is air between bars. */
  fill?: number;
  /** Smallest gap left between neighboring bars (px). */
  minGap?: number;
}

/**
 * Splits `width` into `count` equal slots, one bar centered in each. Bars are thin
 * (capped at `maxBarWidth`) and always keep at least `minGap` of air between them.
 */
export function barLayout(
  count: number,
  left: number,
  width: number,
  { maxBarWidth = 24, fill = 0.62, minGap = 2 }: BarLayoutOptions = {},
): BarLayout {
  if (count <= 0 || width <= 0) return { slotWidth: 0, barWidth: 0, slots: [] };
  const slotWidth = width / count;
  const barWidth = Math.max(
    Math.min(maxBarWidth, slotWidth * fill, slotWidth - minGap),
    Math.min(1, slotWidth),
  );
  const slots = Array.from({ length: count }, (_, index) => {
    const slotX = left + index * slotWidth;
    return { slotX, barX: slotX + (slotWidth - barWidth) / 2, center: slotX + slotWidth / 2 };
  });
  return { slotWidth, barWidth, slots };
}

/** Maps a value to a y coordinate: 0 sits on `baseline`, `axisMax` at `baseline - height`. */
export function scaleY(value: number, axisMax: number, baseline: number, height: number): number {
  if (axisMax <= 0) return baseline;
  const clamped = Math.min(Math.max(value, 0), axisMax);
  return baseline - (clamped / axisMax) * height;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * SVG path of a column that grows up from `baseline` to `top`: rounded corners at the
 * data end, square at the baseline. Empty for a zero-height or zero-width column.
 */
export function columnPath(
  x: number,
  top: number,
  width: number,
  baseline: number,
  radius = 4,
): string {
  const height = baseline - top;
  if (height <= 0 || width <= 0) return '';
  const r = round(Math.min(radius, width / 2, height));
  const [x0, x1, y0, y1] = [round(x), round(x + width), round(top), round(baseline)];
  return [
    `M${x0},${y1}`,
    `V${round(y0 + r)}`,
    `A${r},${r} 0 0 1 ${round(x0 + r)},${y0}`,
    `H${round(x1 - r)}`,
    `A${r},${r} 0 0 1 ${x1},${round(y0 + r)}`,
    `V${y1}`,
    'Z',
  ].join('');
}

/** Index of the slot under `x` (px from the plot's left edge), clamped to the ends. */
export function slotIndexAt(x: number, width: number, count: number): number {
  if (count <= 0 || width <= 0 || !Number.isFinite(x)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}
