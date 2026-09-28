import { useParams } from 'react-router';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { paths } from '@/routes';
import styles from './TrackGameScreen.module.css';

/**
 * Placeholder: live stat entry arrives in a later PR. This screen is full screen
 * on purpose: no tab bar and no update banner may interrupt a live game.
 */
export function TrackGameScreen() {
  const { gameId = '' } = useParams();

  return (
    <main>
      <ScreenHeader title="Live game" backTo={paths.gameReport(gameId)} backLabel="Report" />
      <div className={styles.body}>
        <EmptyState
          icon="⏱️"
          title="Live tracking is coming"
          message="Big one-tap buttons for makes, misses, rebounds and more will fill this screen."
        />
      </div>
    </main>
  );
}
