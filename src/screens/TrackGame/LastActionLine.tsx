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
  tapId?: string;
  /**
   * The stat whose removal this line says is still under way ('Undo not saved yet'), so
   * the screen can say how it went there once it's done.
   */
  removalId?: string;
  /**
   * A short note under the message, e.g. 'Tap the court to mark the spot'. It's about
   * the shot chart's court, which screen readers skip, so they don't hear it either.
   */
  detail?: string;
}

export interface LastActionLineProps {
  action: LastAction;
  /**
   * Bump it when the grid's Undo is tapped: the line's button then ignores taps for a
   * moment, like after its own action.
   */
  holdKey?: number;
}

/**
 * The fixed line between the button grid and the bottom bar that confirms the last
 * action ("3PT Made · Q2") with an inline Undo. It always takes the same space, so
 * nothing moves when it changes, and it never covers a stat button (a floating
 * toast would, and its Undo could catch a tap meant for the button under it).
 *
 * Only the message is a live region, so a screen reader doesn't read "Undo" again
 * with every stat. Each action runs at most once. The button takes a tap right after
 * a stat is recorded (a quick "wrong stat, Undo" must work), but ignores taps for a
 * moment after its own action and after the grid's Undo (just above it), so the
 * second tap of a double tap on either can't act on the line that replaces it.
 */
export function LastActionLine({ action, holdKey = 0 }: LastActionLineProps) {
  const { key, message, kind, tone, actionLabel, onAction, detail } = action;
  const usedKey = useRef<number | null>(null);
  // Every hold (the button's own tap, or the grid's Undo) bumps `holds`; the button
  // is off until DOUBLE_TAP_MS after the latest one.
  const [ownHolds, setOwnHolds] = useState(0);
  const holds = ownHolds + holdKey;
  const [releasedHolds, setReleasedHolds] = useState(holds);
  const held = releasedHolds !== holds;

  useEffect(() => {
    const timer = setTimeout(() => setReleasedHolds(holds), DOUBLE_TAP_MS);
    return () => clearTimeout(timer);
  }, [holds]);

  return (
    <div className={styles.line}>
      <div role="status" aria-label="Last action" className={styles.status}>
        <p key={key} className={cx(styles.message, tone && styles[tone])}>
          {kind ? <span className={cx(styles.dot, styles[kind])} aria-hidden="true" /> : null}
          {detail ? (
            <span className={styles.lines}>
              <span className={styles.text}>{message}</span>
              {/* Keyed, so each new note fades in. */}
              <span key={detail} className={styles.detail} aria-hidden="true">
                {detail}
              </span>
            </span>
          ) : (
            <span className={styles.text}>{message}</span>
          )}
        </p>
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          className={styles.action}
          disabled={held}
          onClick={() => {
            if (held || usedKey.current === key) return;
            usedKey.current = key;
            setOwnHolds((count) => count + 1);
            onAction();
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
