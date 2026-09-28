import { StatTable, type StatTableColumn } from '@/components/StatTable/StatTable';
import type { GamesSummary } from '@/data/stats';
import { formatMadeAttempted } from '@/lib/format';

type TotalKey =
  | 'season'
  | 'gp'
  | 'pts'
  | 'reb'
  | 'oreb'
  | 'dreb'
  | 'ast'
  | 'stl'
  | 'blk'
  | 'tov'
  | 'pf'
  | 'defl'
  | 'chg'
  | 'fg'
  | 'fg3'
  | 'ft';

const COLUMNS: StatTableColumn<TotalKey>[] = [
  { key: 'season', header: 'Season' },
  { key: 'gp', header: 'GP', fullLabel: 'Games played' },
  { key: 'pts', header: 'PTS', fullLabel: 'Points' },
  { key: 'reb', header: 'REB', fullLabel: 'Rebounds' },
  { key: 'oreb', header: 'OREB', fullLabel: 'Offensive rebounds' },
  { key: 'dreb', header: 'DREB', fullLabel: 'Defensive rebounds' },
  { key: 'ast', header: 'AST', fullLabel: 'Assists' },
  { key: 'stl', header: 'STL', fullLabel: 'Steals' },
  { key: 'blk', header: 'BLK', fullLabel: 'Blocks' },
  { key: 'tov', header: 'TO', fullLabel: 'Turnovers' },
  { key: 'pf', header: 'PF', fullLabel: 'Personal fouls' },
  { key: 'defl', header: 'DEFL', fullLabel: 'Deflections' },
  { key: 'chg', header: 'CHG', fullLabel: 'Charges taken' },
  { key: 'fg', header: 'FG', fullLabel: 'Field goals made/attempted' },
  { key: 'fg3', header: '3P', fullLabel: 'Three-pointers made/attempted' },
  { key: 'ft', header: 'FT', fullLabel: 'Free throws made/attempted' },
];

export interface TotalsTableProps {
  /** Names the row: the season label, or 'All games'. */
  label: string;
  summary: Pick<GamesSummary, 'gamesPlayed' | 'totals'>;
}

/** Every counting stat added up over the chosen games, in one row. */
export function TotalsTable({ label, summary: { gamesPlayed, totals } }: TotalsTableProps) {
  return (
    <StatTable
      caption="Totals"
      columns={COLUMNS}
      rows={[
        {
          season: label,
          gp: gamesPlayed,
          pts: totals.pts,
          reb: totals.reb,
          oreb: totals.oreb,
          dreb: totals.dreb,
          ast: totals.ast,
          stl: totals.stl,
          blk: totals.blk,
          tov: totals.tov,
          pf: totals.pf,
          defl: totals.deflections,
          chg: totals.charges,
          fg: formatMadeAttempted(totals.fgm, totals.fga),
          fg3: formatMadeAttempted(totals.fg3m, totals.fg3a),
          ft: formatMadeAttempted(totals.ftm, totals.fta),
        },
      ]}
    />
  );
}
