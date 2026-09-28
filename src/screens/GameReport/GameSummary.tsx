import { Badge } from '@/components/Badge/Badge';
import { Button } from '@/components/Button/Button';
import { ButtonLink } from '@/components/Button/ButtonLink';
import type { Game } from '@/data/types';
import { cx } from '@/lib/cx';
import { formatGameDate } from '@/lib/format';
import { paths } from '@/routes';
import type { ScoreField } from './gameForm';
import { periodName } from './playByPlay';
import { gameOutcome } from './recap';
import styles from './GameSummary.module.css';

export interface GameSummaryProps {
  game: Game;
  /** Opens the edit sheet at a missing score, for a final game without both. */
  onAddScore: (field: ScoreField) => void;
}

const outcomeClass = { W: styles.won, L: styles.lost, T: styles.tied } as const;

/** What to say about a final game's missing score, and which field to fill in first. */
function missingScore(game: Game): { text: string; field: ScoreField } {
  if (game.teamScore !== undefined) {
    return { text: 'Their score is missing', field: 'opponentScore' };
  }
  if (game.opponentScore !== undefined) {
    return { text: 'Our score is missing', field: 'teamScore' };
  }
  return { text: 'No score entered', field: 'teamScore' };
}

/**
 * The lines under the screen title: date, season and venue, then how the game went:
 * the result, a missing score, or (live) "In progress" with a way back in.
 */
export function GameSummary({ game, onAddScore }: GameSummaryProps) {
  const details = [
    formatGameDate(game.date, { withYear: true }),
    game.season,
    game.homeAway === 'neutral' ? 'Neutral site' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const outcome = gameOutcome(game);

  let status;
  if (game.status === 'live') {
    status = (
      <div className={styles.live}>
        <p className={styles.liveStatus}>
          <Badge tone="accent">In progress</Badge>
          <span>{periodName(game.currentPeriod, game.periodFormat)}</span>
        </p>
        <ButtonLink to={paths.trackGame(game.id)} size="lg" block>
          Resume tracking
        </ButtonLink>
      </div>
    );
  } else if (outcome) {
    status = (
      <p className={cx(styles.result, outcomeClass[outcome.result])}>
        <span className={styles.outcome}>{outcome.word}</span>{' '}
        <span className={styles.score}>{outcome.score}</span>
      </p>
    );
  } else {
    const missing = missingScore(game);
    status = (
      <div className={styles.noScore}>
        <p className={styles.noScoreText}>{missing.text}</p>
        <Button variant="ghost" onClick={() => onAddScore(missing.field)}>
          Add score
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.summary}>
      <p className={styles.details}>{details}</p>
      {status}
    </div>
  );
}
