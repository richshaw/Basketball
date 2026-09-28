import { Fragment, memo, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { STAT_DEFS } from '@/data/stats';
import type { StatType } from '@/data/types';
import { cx } from '@/lib/cx';
import { widestWordEm, type StatCounts } from './tracking';
import styles from './StatGrid.module.css';

/** The buttons, row by row, as the parent sees them: shots, then rebounds, then the rest. */
const GRID_STATS = [
  ['fg2_made', 'fg2_miss', 'fg3_made', 'fg3_miss'],
  ['ft_made', 'ft_miss', 'oreb', 'dreb'],
  ['ast', 'stl', 'blk', 'tov'],
  ['foul', 'deflection', 'charge'],
] as const satisfies readonly (readonly StatType[])[];

/** Font size the label words are measured at (any size works; bigger is more precise). */
const MEASURE_PX = 100;

/**
 * Labels are big, but a label's longest word must still fit on one line ("Deflection"
 * is the long one). Measures each label's longest word once, in the label font, and
 * gives it to the CSS as `--label-em`, which sizes the font to the button's width.
 * Where there's no OffscreenCanvas, the CSS falls back to a size that fits any label.
 */
function useFitLabels(gridRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const labels = gridRef.current?.querySelectorAll<HTMLElement>('[data-fit-label]');
    const first = labels?.[0];
    if (!labels || !first || typeof OffscreenCanvas !== 'function') return;
    const context = new OffscreenCanvas(1, 1).getContext('2d');
    if (!context) return;

    const { fontStyle, fontWeight, fontFamily } = getComputedStyle(first);
    context.font = `${fontStyle} ${fontWeight} ${MEASURE_PX}px ${fontFamily}`;
    const measureEm = (word: string) => context.measureText(word).width / MEASURE_PX;
    for (const label of labels) {
      const em = widestWordEm(label.textContent ?? '', measureEm);
      if (em > 0) label.style.setProperty('--label-em', em.toFixed(3));
    }
  }, [gridRef]);
}

/** A quick press-and-brighten, so every tap visibly lands (even a very short one). */
function flash(button: HTMLElement) {
  if (typeof button.animate !== 'function') return;
  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  button.animate(
    reduceMotion
      ? [{ filter: 'brightness(1.3)' }, { filter: 'none' }]
      : [
          { transform: 'scale(0.94)', filter: 'brightness(1.3)' },
          { transform: 'none', filter: 'none' },
        ],
    { duration: 240, easing: 'ease-out' },
  );
}

interface StatButtonProps {
  type: StatType;
  /** How many of this stat the game has so far. */
  count: number;
  onRecord: (type: StatType) => void;
}

/**
 * One stat button. Memoized: recording a stat re-renders only the button whose
 * count changed. The name is the stat alone and the count is its description, so
 * VoiceOver (and Voice Control) always find "2PT Made" by the same name.
 */
const StatButton = memo(function StatButton({ type, count, onRecord }: StatButtonProps) {
  const { label, kind } = STAT_DEFS[type];
  const countId = useId();

  return (
    <button
      type="button"
      className={cx(styles.button, styles[kind])}
      aria-label={label}
      aria-describedby={count > 0 ? countId : undefined}
      onClick={(event) => {
        // Save first; never wait on the database before showing the tap landed.
        onRecord(type);
        flash(event.currentTarget);
      }}
    >
      <span className={styles.label} data-fit-label="">
        {/* One word per line, the same on every screen size ("2PT" over "Made"). */}
        {label.split(' ').map((word, index) => (
          <Fragment key={word}>
            {index > 0 ? ' ' : null}
            <span className={styles.word}>{word}</span>
          </Fragment>
        ))}
      </span>
      {count > 0 ? (
        <>
          <span className={cx(styles.count, 'tabular-nums')}>{count}</span>
          <span id={countId} className="visually-hidden">{`${count} this game`}</span>
        </>
      ) : null}
    </button>
  );
});

const UndoButton = memo(function UndoButton({ onUndo }: { onUndo: () => void }) {
  return (
    <button
      type="button"
      className={cx(styles.button, styles.undo)}
      aria-label="Undo last stat"
      onClick={(event) => {
        onUndo();
        flash(event.currentTarget);
      }}
    >
      <span className={styles.label} data-fit-label="">
        Undo
      </span>
    </button>
  );
});

export interface StatGridProps {
  counts: StatCounts;
  /** Records one stat. Keep it stable (useCallback), or every button re-renders. */
  onRecord: (type: StatType) => void;
  /** Removes the game's most recent stat. Keep it stable too. */
  onUndo: () => void;
}

/**
 * The 4x4 grid of big stat buttons (the last one is Undo). It fills whatever height
 * its parent gives it, so other parts (e.g. a shot chart) can take space above it.
 */
export const StatGrid = memo(function StatGrid({ counts, onRecord, onUndo }: StatGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  useFitLabels(gridRef);

  return (
    <div ref={gridRef} role="group" aria-label="Record a stat" className={styles.grid}>
      {GRID_STATS.flat().map((type) => (
        <StatButton key={type} type={type} count={counts[type]} onRecord={onRecord} />
      ))}
      <UndoButton onUndo={onUndo} />
    </div>
  );
});
