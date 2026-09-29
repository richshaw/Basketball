import { cx } from '@/lib/cx';
import type { Tap } from './session';
import { statLabel, unsavedNote } from './tracking';
import styles from './UnsavedStats.module.css';

export interface UnsavedStatsProps {
  /** Taps that couldn't be saved yet, oldest first. */
  unsaved: readonly Tap[];
  /** They're all kept on this phone (in the pending-stats journal). */
  kept: boolean;
  /** They're being saved again right now. */
  retrying: boolean;
  onRetry: () => void;
  /** Laid over the compact stat strip (see StatStrip): smaller type to fit it. */
  compact?: boolean;
}

/**
 * "Steal not saved · Retry": shown over the stat strip until every tap is saved,
 * whatever is tapped meanwhile. It covers the strip rather than pushing the buttons
 * down, so nothing moves under a finger. Retry is off while a retry runs, so a
 * double tap can't start a second one.
 */
export function UnsavedStats({
  unsaved,
  kept,
  retrying,
  onRetry,
  compact = false,
}: UnsavedStatsProps) {
  const [first] = unsaved;
  if (!first) return null;
  const message =
    unsaved.length === 1
      ? `${statLabel(first.type)} not saved`
      : `${unsaved.length} stats not saved`;

  return (
    <div className={cx(styles.row, compact && styles.compact)}>
      <p role="alert" className={styles.message}>
        {/* The space keeps the two apart when read out: "Steal not saved It's kept…". */}
        <span className={styles.title}>{message}</span>{' '}
        <span className={styles.hint}>
          {retrying ? 'Saving again…' : unsavedNote(unsaved.length, kept)}
        </span>
      </p>
      <button type="button" className={styles.retry} disabled={retrying} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
