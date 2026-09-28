/**
 * The "Export spreadsheet (CSV)" file: one row per final game with its result and
 * box score, for Numbers, Excel or Google Sheets. Pure: no database, no DOM.
 */
import { gameResult, statLinesForGames, type GameStatLine, type StatLine } from '@/data/stats';
import type { Game, HomeAway, StatEvent } from '@/data/types';

/** Byte order mark: tells Excel the file is UTF-8, so names like "Zoë" survive. */
export const CSV_BOM = '\uFEFF';

/** RFC 4180 line ending, which every spreadsheet app reads. */
const CRLF = '\r\n';

type Cell = string | number | undefined;

interface Column {
  header: string;
  value: (entry: GameStatLine) => Cell;
}

const HOME_AWAY_LABELS: Record<HomeAway, string> = {
  home: 'Home',
  away: 'Away',
  neutral: 'Neutral',
};

const stat =
  (key: keyof StatLine) =>
  ({ line }: GameStatLine): number =>
    line[key];

/** The columns, in order. */
const COLUMNS: readonly Column[] = [
  // ISO dates (2026-09-27) sort correctly and every spreadsheet reads them as dates.
  { header: 'Date', value: ({ game }) => game.date },
  { header: 'Opponent', value: ({ game }) => game.opponent },
  {
    header: 'Home/Away',
    value: ({ game }) => (game.homeAway ? HOME_AWAY_LABELS[game.homeAway] : undefined),
  },
  { header: 'Season', value: ({ game }) => game.season },
  { header: 'Result', value: ({ game }) => gameResult(game) ?? undefined },
  { header: 'Our score', value: ({ game }) => game.teamScore },
  { header: 'Their score', value: ({ game }) => game.opponentScore },
  { header: 'PTS', value: stat('pts') },
  { header: 'FGM', value: stat('fgm') },
  { header: 'FGA', value: stat('fga') },
  { header: '3PM', value: stat('fg3m') },
  { header: '3PA', value: stat('fg3a') },
  { header: 'FTM', value: stat('ftm') },
  { header: 'FTA', value: stat('fta') },
  { header: 'OREB', value: stat('oreb') },
  { header: 'DREB', value: stat('dreb') },
  { header: 'REB', value: stat('reb') },
  { header: 'AST', value: stat('ast') },
  { header: 'STL', value: stat('stl') },
  { header: 'BLK', value: stat('blk') },
  { header: 'TO', value: stat('tov') },
  { header: 'PF', value: stat('pf') },
  { header: 'DEFL', value: stat('deflections') },
  { header: 'CHG', value: stat('charges') },
];

export const GAMES_CSV_HEADERS: readonly string[] = COLUMNS.map((column) => column.header);

/** Spreadsheets treat text starting with one of these as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Text with one of these must be quoted. */
const NEEDS_QUOTES = /[",\r\n]/;

/**
 * One CSV field. Numbers are written as they are. Text is quoted when it holds a
 * quote, comma or line break (quotes doubled, per RFC 4180), and text a spreadsheet
 * would run as a formula (an opponent typed as "=1+1") gets a leading apostrophe.
 */
export function csvField(value: Cell): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function compareOldestFirst(a: Game, b: Game): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The CSV text: a UTF-8 BOM, a header row, then one row per FINAL game, oldest first
 * (live games are left out: their numbers aren't final). Lines end with CRLF.
 */
export function buildGamesCsv(
  games: readonly Game[],
  events: readonly Pick<StatEvent, 'gameId' | 'type'>[],
): string {
  const finals = games.filter((game) => game.status === 'final').sort(compareOldestFirst);
  const rows = [
    GAMES_CSV_HEADERS.map(csvField),
    ...statLinesForGames(finals, events).map((entry) =>
      COLUMNS.map((column) => csvField(column.value(entry))),
    ),
  ];
  return CSV_BOM + rows.map((fields) => fields.join(',') + CRLF).join('');
}
