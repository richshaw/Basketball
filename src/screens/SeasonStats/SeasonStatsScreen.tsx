import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import styles from './SeasonStatsScreen.module.css';

/** Placeholder: season totals and averages arrive in a later PR. */
export function SeasonStatsScreen() {
  return (
    <main>
      <ScreenHeader title="Stats" />
      <div className={styles.body}>
        <EmptyState
          icon="📊"
          title="Season stats are coming"
          message="Totals, averages and shooting percentages across every game will show up here."
        />
      </div>
    </main>
  );
}
