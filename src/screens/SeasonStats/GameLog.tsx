import { Link } from 'react-router';
import {
  StatTable,
  type StatTableColumn,
  type StatTableRow,
} from '@/components/StatTable/StatTable';
import { gameResult, type GameStatLine } from '@/data/stats';
import type { Game } from '@/data/types';
import { cx } from '@/lib/cx';
import { formatGameDate, formatMadeAttempted } from '@/lib/format';
import { paths } from '@/routes';
import { gameTitle } from '@/lib/gameTitle';
import { formatScore } from './gameLabels';
import styles from './SeasonStatsScreen.module.css';

type LogKey =
  'game' | 'result' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'pf' | 'fg' | 'fg3' | 'ft';

const COLUMNS: StatTableColumn<LogKey>[] = [
  { key: 'game', header: 'Game' },
  { key: 'result', header: 'Result' },
  { key: 'pts', header: 'PTS', fullLabel: 'Points' },
  { key: 'reb', header: 'REB', fullLabel: 'Rebounds' },
  { key: 'ast', header: 'AST', fullLabel: 'Assists' },
  { key: 'stl', header: 'STL', fullLabel: 'Steals' },
  { key: 'blk', header: 'BLK', fullLabel: 'Blocks' },
  { key: 'tov', header: 'TO', fullLabel: 'Turnovers' },
  { key: 'pf', header: 'PF', fullLabel: 'Personal fouls' },
  { key: 'fg', header: 'FG', fullLabel: 'Field goals made/attempted' },
  { key: 'fg3', header: '3P', fullLabel: 'Three-pointers made/attempted' },
  { key: 'ft', header: 'FT', fullLabel: 'Free throws made/attempted' },
];

const resultClass = { W: styles.win, L: styles.loss, T: styles.tie } as const;

function Result({ game }: { game: Game }) {
  const result = gameResult(game);
  const score = formatScore(game);
  if (!result || !score) return <span className={styles.noResult}>–</span>;
  return (
    <span className={styles.result}>
      <span className={cx(styles.resultLetter, resultClass[result])}>{result}</span> {score}
    </span>
  );
}

export interface GameLogProps {
  /** Games to list, newest first, each with its stat line. */
  entries: readonly GameStatLine[];
  /** Show the dates' years (the games span more than one year). */
  withYear: boolean;
}

/** Every game's box score line, newest first. Tapping a row opens that game's report. */
export function GameLog({ entries, withYear }: GameLogProps) {
  const rows: StatTableRow<LogKey>[] = entries.map(({ game, line }) => ({
    game: (
      <Link to={paths.gameReport(game.id)} className={styles.gameLink}>
        <span className={styles.gameOpponent}>{gameTitle(game)}</span>
        <span className="visually-hidden">, </span>
        <span className={styles.gameDate}>{formatGameDate(game.date, { withYear })}</span>
      </Link>
    ),
    result: <Result game={game} />,
    pts: line.pts,
    reb: line.reb,
    ast: line.ast,
    stl: line.stl,
    blk: line.blk,
    tov: line.tov,
    pf: line.pf,
    fg: formatMadeAttempted(line.fgm, line.fga),
    fg3: formatMadeAttempted(line.fg3m, line.fg3a),
    ft: formatMadeAttempted(line.ftm, line.fta),
  }));

  return (
    <StatTable
      caption="Game log"
      columns={COLUMNS}
      rows={rows}
      rowKey={(_, index) => entries[index]?.game.id ?? index}
      linkedRows
    />
  );
}
