/**
 * Display formatting shared by every screen. Game dates are LOCAL calendar dates
 * ('YYYY-MM-DD'), so they're never parsed with `new Date('2026-09-27')`, which
 * means midnight UTC and shows the previous day west of Greenwich.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A number as at least two digits: pad2(7) is '07'. */
export function pad2(value: number): string {
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

/**
 * 'Sun, Sep 27' (or 'Sun, Sep 27, 2026' with `withYear`). Anything that isn't a
 * valid 'YYYY-MM-DD' date is returned unchanged.
 */
export function formatGameDate(isoDate: string, { withYear = false } = {}): string {
  const date = parseLocalDate(isoDate);
  if (!date) return isoDate;
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
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
