import type { StatDef } from '@/data/stats';
import { cx } from '@/lib/cx';
import styles from './LastActionLine.module.css';

/** What the last-action line shows. */
export interface LastAction {
  /** Changes with every action, so a repeat of the same message still visibly updates. */
  key: number;
  /** E.g. '3PT Made · Q2', 'Removed 3PT Made' or 'Now in Q3'. */
  message: string;
  /** A stat's kind, shown as a colored dot (made, miss or other). */
  kind?: StatDef['kind'];
  /** `muted` for hints and results, `error` for something that failed. */
  tone?: 'muted' | 'error';
  /** E.g. 'Undo' or 'Retry'. */
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * The fixed line between the button grid and the bottom bar that confirms the last
 * action ("3PT Made · Q2") with an inline Undo. It always takes the same space, so
 * nothing moves when it changes, and it never covers a stat button (a floating
 * toast would, and its Undo could catch a tap meant for the button under it).
 */
export function LastActionLine({ action }: { action: LastAction }) {
  const { key, message, kind, tone, actionLabel, onAction } = action;

  return (
    <div role="status" aria-label="Last action" className={styles.line}>
      <p key={key} className={cx(styles.message, tone && styles[tone])}>
        {kind ? <span className={cx(styles.dot, styles[kind])} aria-hidden="true" /> : null}
        <span className={styles.text}>{message}</span>
      </p>
      {actionLabel && onAction ? (
        <button type="button" className={styles.action} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
