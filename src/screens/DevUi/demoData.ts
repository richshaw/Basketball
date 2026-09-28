import type { SegmentedOption } from '@/components/SegmentedControl/SegmentedControl';
import type { StatTableColumn, StatTableRow } from '@/components/StatTable/StatTable';

/** Made-up sample data for the component gallery. Nothing here is real app data. */

export type PeriodFormat = 'quarters' | 'halves';
export const periodFormats: SegmentedOption<PeriodFormat>[] = [
  { value: 'quarters', label: 'Quarters' },
  { value: 'halves', label: 'Halves' },
];

export type Venue = 'home' | 'away' | 'neutral';
export const venues: SegmentedOption<Venue>[] = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
  { value: 'neutral', label: 'Neutral' },
];

export type GameFilter = 'all' | 'last5' | 'home' | 'away';
export const gameFilters: SegmentedOption<GameFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'last5', label: 'Last 5' },
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
];

export const opponents = ['Tigers', 'Hawks', 'Comets', 'Lions', 'Wildcats', 'Storm'];

/** A long list, to show a sheet whose content scrolls. */
export const manyOpponents = [
  ...opponents,
  'Blazers',
  'Bulldogs',
  'Cougars',
  'Dragons',
  'Eagles',
  'Falcons',
  'Hornets',
  'Jaguars',
  'Knights',
  'Mustangs',
  'Panthers',
  'Raptors',
  'Rockets',
  'Spartans',
  'Thunder',
  'Titans',
  'Vipers',
  'Wolves',
];

type BoxKey =
  | 'period'
  | 'pts'
  | 'fg'
  | 'three'
  | 'ft'
  | 'oreb'
  | 'dreb'
  | 'reb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'to'
  | 'pf';

export const boxScoreColumns: StatTableColumn<BoxKey>[] = [
  { key: 'period', header: 'Qtr', fullLabel: 'Quarter' },
  { key: 'pts', header: 'PTS', fullLabel: 'Points' },
  { key: 'fg', header: 'FG', fullLabel: 'Field goals made-attempted' },
  { key: 'three', header: '3PT', fullLabel: 'Three-pointers made-attempted' },
  { key: 'ft', header: 'FT', fullLabel: 'Free throws made-attempted' },
  { key: 'oreb', header: 'OREB', fullLabel: 'Offensive rebounds' },
  { key: 'dreb', header: 'DREB', fullLabel: 'Defensive rebounds' },
  { key: 'reb', header: 'REB', fullLabel: 'Rebounds' },
  { key: 'ast', header: 'AST', fullLabel: 'Assists' },
  { key: 'stl', header: 'STL', fullLabel: 'Steals' },
  { key: 'blk', header: 'BLK', fullLabel: 'Blocks' },
  { key: 'to', header: 'TO', fullLabel: 'Turnovers' },
  { key: 'pf', header: 'PF', fullLabel: 'Personal fouls' },
];

// prettier-ignore
export const boxScoreRows: StatTableRow<BoxKey>[] = [
  { period: 'Q1', pts: 4, fg: '2-3', three: '0-1', ft: '0-0', oreb: 1, dreb: 2, reb: 3, ast: 1, stl: 1, blk: 0, to: 1, pf: 0 },
  { period: 'Q2', pts: 2, fg: '1-3', three: '0-0', ft: '0-2', oreb: 0, dreb: 1, reb: 1, ast: 2, stl: 0, blk: 1, to: 0, pf: 1 },
  { period: 'Q3', pts: 5, fg: '1-2', three: '1-1', ft: '2-2', oreb: 1, dreb: 1, reb: 2, ast: 0, stl: 1, blk: 0, to: 2, pf: 1 },
  { period: 'Q4', pts: 3, fg: '1-1', three: '0-0', ft: '1-2', oreb: 0, dreb: 1, reb: 1, ast: 0, stl: 0, blk: 0, to: 0, pf: 2 },
];

// prettier-ignore
export const boxScoreTotal: StatTableRow<BoxKey> = {
  period: 'Total', pts: 14, fg: '5-9', three: '1-2', ft: '3-6', oreb: 2, dreb: 5, reb: 7, ast: 3, stl: 2, blk: 1, to: 3, pf: 4,
};

type LogKey = 'game' | 'pts' | 'reb' | 'ast';

export const gameLogColumns: StatTableColumn<LogKey>[] = [
  { key: 'game', header: 'Game' },
  { key: 'pts', header: 'PTS', fullLabel: 'Points' },
  { key: 'reb', header: 'REB', fullLabel: 'Rebounds' },
  { key: 'ast', header: 'AST', fullLabel: 'Assists' },
];

export const gameLogRows: StatTableRow<LogKey>[] = [
  { game: 'Sep 26 · Tigers', pts: 14, reb: 7, ast: 3 },
  { game: 'Sep 19 · Hawks', pts: 9, reb: 4, ast: 5 },
  { game: 'Sep 12 · Comets', pts: 18, reb: 6, ast: 2 },
  { game: 'Sep 5 · Lions', pts: 6, reb: 8, ast: 1 },
];

export const gameLogAverage: StatTableRow<LogKey> = {
  game: 'Average',
  pts: '11.8',
  reb: '6.3',
  ast: '2.8',
};

export const gameSummary = [
  'Hoop Stats · vs Tigers, Sat Sep 26',
  '14 PTS · 7 REB · 3 AST · 2 STL',
  'FG 5/9 · 3PT 1/2 · FT 3/6',
].join('\n');
