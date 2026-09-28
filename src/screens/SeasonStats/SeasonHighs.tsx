import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { HIGH_STATS, type GamesSummary, type HighStat } from '@/data/stats';
import type { Game } from '@/data/types';
import { formatGameDate } from '@/lib/format';
import { paths } from '@/routes';
import { opponentLabel } from './gameLabels';
import styles from './SeasonStatsScreen.module.css';

const HIGH_LABELS: Record<HighStat, string> = {
  pts: 'Points',
  reb: 'Rebounds',
  ast: 'Assists',
  stl: 'Steals',
  blk: 'Blocks',
  deflections: 'Deflections',
};

export interface SeasonHighsProps {
  /** 'Season highs', or 'Career highs' across every season. */
  title: string;
  highs: GamesSummary['highs'];
  /** The games the highs came from, by id. */
  games: ReadonlyMap<string, Game>;
  /** Show the dates' years (the games span more than one year). */
  withYear: boolean;
}

/** The best single game for each stat; each row opens that game's report. */
export function SeasonHighs({ title, highs, games, withYear }: SeasonHighsProps) {
  return (
    <GroupedList header={title}>
      {HIGH_STATS.map((stat) => {
        const high = highs[stat];
        const game = high ? games.get(high.gameId) : undefined;
        const label = HIGH_LABELS[stat];
        if (!high || !game) {
          return <ListRow key={stat} title={label} subtitle="None yet" value="–" />;
        }
        return (
          <ListRow
            key={stat}
            // Screen readers hear "Points: 18, vs Lincoln · Sat, Sep 12".
            title={
              <>
                {label}
                <span className="visually-hidden">: {high.value},</span>
              </>
            }
            subtitle={`${opponentLabel(game)} · ${formatGameDate(game.date, { withYear })}`}
            value={
              <span className={styles.highValue} aria-hidden="true">
                {high.value}
              </span>
            }
            to={paths.gameReport(game.id)}
          />
        );
      })}
    </GroupedList>
  );
}
