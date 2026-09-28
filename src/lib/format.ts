/**
 * Display formatting shared by every screen. Game dates are LOCAL calendar dates
 * ('YYYY-MM-DD'), so they're never parsed with `new Date('2026-09-27')`, which
 * means midnight UTC and shows the previous day west of Greenwich.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** A Date's local calendar day as 'YYYY-MM-DD'. */
export function toLocalISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Today's local date as 'YYYY-MM-DD' (the default date for a new game). */
export function todayLocalISO(now: Date = new Date()): string {
  return toLocalISODate(now);
}

/** Local midnight of a 'YYYY-MM-DD' date, or null if it isn't a real calendar date. */
export function parseLocalDate(isoDate: string): Date | null {
  const match = ISO_DATE.exec(isoDate);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // Rejects dates like 2026-02-30 (which Date rolls over into March) and years < 100.
  return toLocalISODate(date) === isoDate ? date : null;
}

/** Whether `value` is a real calendar date written as 'YYYY-MM-DD'. */
export function isLocalISODate(value: string): boolean {
  return parseLocalDate(value) !== null;
}

export interface GameDateOptions {
  /** Add the year: 'Sun, Sep 27, 2026'. */
  withYear?: boolean;
  /** Start with the weekday (the default). `false` gives 'Sep 27', e.g. for a chart axis. */
  weekday?: boolean;
}

// Creating a date formatter is slow, and lists format many dates, so each style is made
// once. They format in UTC (the dates they get are UTC midnight), so a formatter made
// before the phone changed time zone still shows the right day.
const gameDateFormats = new Map<string, Intl.DateTimeFormat>();

function gameDateFormat(withYear: boolean, weekday: boolean): Intl.DateTimeFormat {
  const key = `${String(withYear)}:${String(weekday)}`;
  let format = gameDateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      ...(weekday ? { weekday: 'short' } : {}),
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
    gameDateFormats.set(key, format);
  }
  return format;
}

/**
 * 'Sun, Sep 27' ('Sun, Sep 27, 2026' with `withYear`, 'Sep 27' with `weekday: false`).
 * Anything that isn't a valid 'YYYY-MM-DD' date is returned unchanged.
 */
export function formatGameDate(
  isoDate: string,
  { withYear = false, weekday = true }: GameDateOptions = {},
): string {
  const date = parseLocalDate(isoDate);
  if (!date) return isoDate;
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return gameDateFormat(withYear, weekday).format(day);
}

/** A 0-100 percentage as '45%', or '–' when there's nothing to divide (null). */
export function formatPct(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '–'
    : `${Math.round(value)}%`;
}

/**
 * A per-game average with one decimal, rounded half up: '12.3', '0.9', '0.0'.
 * `summarizeGames` averages are already rounded exactly. For other values, rounding
 * the tenths first stops binary noise from rounding a true .x5 down (0.85 is stored
 * as 0.8499…, which `toFixed(1)` alone shows as '0.8').
 */
export function formatAvg(value: number): string {
  return Number.isFinite(value) ? (Math.round(value * 10) / 10).toFixed(1) : '–';
}

/** Makes and attempts as '5/9'. */
export function formatMadeAttempted(made: number, attempted: number): string {
  return `${made}/${attempted}`;
}

/** The player's name, or 'Player' before the parent has entered one. */
export function formatPlayerName(player: { name: string } | null | undefined): string {
  return player?.name.trim() || 'Player';
}
