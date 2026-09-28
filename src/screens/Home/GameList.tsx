import { Badge } from '@/components/Badge/Badge';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import type { GameStatLine, StatLine } from '@/data/stats';
import { paths } from '@/routes';
import { gameTitle } from '@/lib/gameTitle';
import { countOf, gameDateLabel, groupBySeason, resultBadge } from './gameRows';
import styles from './GameList.module.css';

/** The headline numbers for a row: "14 PTS · 6 REB". */
function KeyLine({ line }: { line: StatLine }) {
  return (
    <span className={styles.keyLine}>
      <span className={styles.number}>{line.pts}</span> PTS ·{' '}
      <span className={styles.number}>{line.reb}</span> REB
    </span>
  );
}

function GameRow({ game, line, today }: GameStatLine & { today: string }) {
  const badge = resultBadge(game);
  const live = game.status === 'live';

  return (
    <ListRow
      title={gameTitle(game)}
      subtitle={gameDateLabel(game.date, today)}
      value={
        <>
          <span className={styles.value} aria-hidden="true">
            <Badge tone={badge.tone} className={styles.badge}>
              {badge.label}
            </Badge>
            <KeyLine line={line} />
          </span>
          {/* Read out as one phrase: "Won 45 to 38, 14 points, 6 rebounds". */}
          <span className="visually-hidden">
            {`${badge.spoken}, ${countOf(line.pts, 'point')}, ${countOf(line.reb, 'rebound')}`}
          </span>
        </>
      }
      // A live game carries on where it left off; a finished one opens its report.
      to={live ? paths.trackGame(game.id) : paths.gameReport(game.id)}
    />
  );
}

export interface GameListProps {
  /** Every game with the player's stat line, newest first. */
  entries: readonly GameStatLine[];
  /** Today's local date, so older games can show their year. */
  today: string;
}

/**
 * Every game, newest first, in a section per season (the current one on top) headed
 * by its name. The season sits in the header rather than on each row: next to the
 * stat line there's only room for the date on an iPhone.
 */
export function GameList({ entries, today }: GameListProps) {
  const groups = groupBySeason(entries);
  // Games that were never given a season need no header, unless others were.
  const headed = groups.some(({ season }) => season !== undefined);

  return (
    <div>
      {groups.map(({ season, entries: games }) => (
        <GroupedList
          key={season ?? ''}
          header={headed ? (season ?? 'No season') : undefined}
          aria-label={headed ? undefined : 'Games'}
        >
          {games.map(({ game, line }) => (
            <GameRow key={game.id} game={game} line={line} today={today} />
          ))}
        </GroupedList>
      ))}
    </div>
  );
}
