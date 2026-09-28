import { useId } from 'react';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { StatTile, StatTileGrid } from '@/components/StatTile/StatTile';
import { periodLabel, type StatLine } from '@/data/stats';
import type { Game } from '@/data/types';
import { paths } from '@/routes';
import { gameDateLabel, gameTitle } from './gameRows';
import styles from './LiveGameCard.module.css';

export interface LiveGameCardProps {
  game: Game;
  /** The player's stats in this game so far. */
  line: StatLine;
  /** Today's local date, so an older live game can show its year. */
  today: string;
}

/**
 * The game still in progress, with the player's running line and a big way back in. It is the
 * first thing on Games: iOS may relaunch the app mid-game, and this is the way back.
 */
export function LiveGameCard({ game, line, today }: LiveGameCardProps) {
  const headingId = useId();
  const date = gameDateLabel(game.date, today);

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.overline}>
        <span className={styles.dot} aria-hidden="true" />
        Game in progress
      </h2>
      <div className={styles.titleRow}>
        <p className={styles.opponent}>{gameTitle(game)}</p>
        <p className={styles.period}>{periodLabel(game.currentPeriod, game.periodFormat)}</p>
      </div>
      <p className={styles.meta}>{game.season ? `${date} · ${game.season}` : date}</p>
      <StatTileGrid columns={3} aria-label="Stats so far" className={styles.stats}>
        <StatTile value={line.pts} label="PTS" fullLabel="Points" highlight />
        <StatTile value={line.reb} label="REB" fullLabel="Rebounds" />
        <StatTile value={line.ast} label="AST" fullLabel="Assists" />
      </StatTileGrid>
      <ButtonLink to={paths.trackGame(game.id)} size="lg" block>
        Resume game
      </ButtonLink>
    </section>
  );
}
