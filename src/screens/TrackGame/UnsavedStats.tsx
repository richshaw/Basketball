import type { Tap } from './session';
import { statLabel } from './tracking';
import styles from './UnsavedStats.module.css';

export interface UnsavedStatsProps {
  /** Taps that couldn't be saved yet, oldest first. */
  unsaved: readonly Tap[];
  /** They're being saved again right now. */
  retrying: boolean;
  onRetry: () => void;
}

/**
 * "Steal not saved · Retry": shown over the stat strip (whose totals leave these
 * taps out) until every tap is saved, whatever is tapped meanwhile. It covers the
 * strip rather than pushing the buttons down, so nothing moves under a finger.
 * Retry is off while a retry runs, so a double tap can't start a second one.
 */
export function UnsavedStats({ unsaved, retrying, onRetry }: UnsavedStatsProps) {
  const [first] = unsaved;
  if (!first) return null;
  const message =
    unsaved.length === 1
      ? `${statLabel(first.type)} not saved`
      : `${unsaved.length} stats not saved`;

  return (
    <div className={styles.row}>
      <p role="alert" className={styles.message}>
        <span className={styles.title}>{message}</span>
        <span className={styles.hint}>
          {retrying ? 'Saving again…' : 'Kept on this screen. Tap Retry to save.'}
        </span>
      </p>
      <button type="button" className={styles.retry} disabled={retrying} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
