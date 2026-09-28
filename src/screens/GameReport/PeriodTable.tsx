import {
  StatTable,
  type StatTableColumn,
  type StatTableRow,
} from '@/components/StatTable/StatTable';
import { computeStatLine, statLinesByPeriod, type StatLine } from '@/data/stats';
import type { Game, StatEvent } from '@/data/types';
import { formatMadeAttempted } from '@/lib/format';

type Column = 'period' | 'pts' | 'fg' | 'fg3' | 'ft' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'pf';

const STAT_COLUMNS: readonly StatTableColumn<Column>[] = [
  { key: 'pts', header: 'PTS', fullLabel: 'Points' },
  { key: 'fg', header: 'FG', fullLabel: 'Field goals made of attempted' },
  { key: 'fg3', header: '3P', fullLabel: 'Three-pointers made of attempted' },
  { key: 'ft', header: 'FT', fullLabel: 'Free throws made of attempted' },
  { key: 'reb', header: 'REB', fullLabel: 'Rebounds' },
  { key: 'ast', header: 'AST', fullLabel: 'Assists' },
  { key: 'stl', header: 'STL', fullLabel: 'Steals' },
  { key: 'blk', header: 'BLK', fullLabel: 'Blocks' },
  { key: 'tov', header: 'TO', fullLabel: 'Turnovers' },
  { key: 'pf', header: 'PF', fullLabel: 'Personal fouls' },
];

function rowOf(label: string, line: StatLine): StatTableRow<Column> {
  return {
    period: label,
    pts: line.pts,
    fg: formatMadeAttempted(line.fgm, line.fga),
    fg3: formatMadeAttempted(line.fg3m, line.fg3a),
    ft: formatMadeAttempted(line.ftm, line.fta),
    reb: line.reb,
    ast: line.ast,
    stl: line.stl,
    blk: line.blk,
    tov: line.tov,
    pf: line.pf,
  };
}

export interface PeriodTableProps {
  game: Game;
  events: readonly StatEvent[];
}

/**
 * The box score split by quarter (or half), overtimes included, with a total row.
 * A live game's current period is highlighted.
 */
export function PeriodTable({ game, events }: PeriodTableProps) {
  const halves = game.periodFormat === 'halves';
  const periods = statLinesByPeriod(events, game);
  const current = periods.findIndex((entry) => entry.period === game.currentPeriod);
  const columns: StatTableColumn<Column>[] = [
    { key: 'period', header: halves ? 'Half' : 'Qtr', fullLabel: halves ? 'Half' : 'Quarter' },
    ...STAT_COLUMNS,
  ];

  return (
    <StatTable
      caption={halves ? 'Stats by half' : 'Stats by quarter'}
      columns={columns}
      rows={periods.map((entry) => rowOf(entry.label, entry.line))}
      totalRow={rowOf('Total', computeStatLine(events))}
      highlightedRow={game.status === 'live' && current >= 0 ? current : undefined}
    />
  );
}
