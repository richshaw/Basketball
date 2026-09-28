import { useEffect, useRef, useState } from 'react';
import type { StatDef } from '@/data/stats';
import { cx } from '@/lib/cx';
import { DOUBLE_TAP_MS } from './tracking';
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
  /** E.g. 'Undo'. */
  actionLabel?: string;
  onAction?: () => void;
  /** The tap this line confirms, if it's a stat (so the screen can say it wasn't saved). */
  tapId?: number;
}

/**
 * The fixed line between the button grid and the bottom bar that confirms the last
 * action ("3PT Made · Q2") with an inline Undo. It always takes the same space, so
 * nothing moves when it changes, and it never covers a stat button (a floating
 * toast would, and its Undo could catch a tap meant for the button under it).
 *
 * Only the message is a live region, so a screen reader doesn't read "Undo" again
 * with every stat. The button ignores taps for a moment after the line changes (the
 * second tap of a double tap on the button before it must not land on this one), and
 * each action runs at most once.
 */
export function LastActionLine({ action }: { action: LastAction }) {
  const { key, message, kind, tone, actionLabel, onAction } = action;
  const [readyKey, setReadyKey] = useState<number | null>(null);
  const usedKey = useRef<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setReadyKey(key), DOUBLE_TAP_MS);
    return () => clearTimeout(timer);
  }, [key]);

  return (
    <div className={styles.line}>
      <div role="status" aria-label="Last action" className={styles.status}>
        <p key={key} className={cx(styles.message, tone && styles[tone])}>
          {kind ? <span className={cx(styles.dot, styles[kind])} aria-hidden="true" /> : null}
          <span className={styles.text}>{message}</span>
        </p>
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          className={styles.action}
          disabled={readyKey !== key}
          onClick={() => {
            if (usedKey.current === key) return;
            usedKey.current = key;
            onAction();
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
