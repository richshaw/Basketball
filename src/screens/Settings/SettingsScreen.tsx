import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import styles from './SettingsScreen.module.css';

/** Placeholder: player details and app options arrive in a later PR. */
export function SettingsScreen() {
  return (
    <main>
      <ScreenHeader title="Settings" />
      <div className={styles.body}>
        <EmptyState
          icon="⚙️"
          title="Settings are coming"
          message="Player details and app options will live here."
        />
      </div>
    </main>
  );
}
