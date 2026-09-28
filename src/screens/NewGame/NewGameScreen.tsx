import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { paths } from '@/routes';
import styles from './NewGameScreen.module.css';

/** Placeholder: the new-game form arrives in a later PR. */
export function NewGameScreen() {
  return (
    <main>
      <ScreenHeader title="New game" backTo={paths.home} backLabel="Games" />
      <div className={styles.body}>
        <EmptyState
          icon="📝"
          title="Game setup is coming"
          message="Enter the opponent and date, then start tracking."
        />
      </div>
    </main>
  );
}
