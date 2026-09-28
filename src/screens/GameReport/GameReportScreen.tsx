import { useParams } from 'react-router';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { paths } from '@/routes';
import styles from './GameReportScreen.module.css';

/** Placeholder: the per-game box score arrives in a later PR. */
export function GameReportScreen() {
  const { gameId = '' } = useParams();

  return (
    <main>
      <ScreenHeader title="Game report" backTo={paths.home} backLabel="Games" />
      <div className={styles.body}>
        <EmptyState
          icon="📋"
          title="The box score is coming"
          message="Points, shooting splits and every other stat from this game will appear here."
          action={
            <ButtonLink to={paths.trackGame(gameId)} variant="secondary">
              Track game
            </ButtonLink>
          }
        />
      </div>
    </main>
  );
}
