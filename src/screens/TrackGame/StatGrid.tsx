import { Fragment, memo, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { STAT_DEFS } from '@/data/stats';
import type { StatType } from '@/data/types';
import { cx } from '@/lib/cx';
import { widestWordOnCanvas, type StatCounts } from './tracking';
import styles from './StatGrid.module.css';

/** The buttons, row by row, as the parent sees them: shots, then rebounds, then the rest. */
const GRID_STATS = [
  ['fg2_made', 'fg2_miss', 'fg3_made', 'fg3_miss'],
  ['ft_made', 'ft_miss', 'oreb', 'dreb'],
  ['ast', 'stl', 'blk', 'tov'],
  ['foul', 'deflection', 'charge'],
] as const satisfies readonly (readonly StatType[])[];

/**
 * Shorter words on the grid only (the log and reports keep the full names), so every
 * label is at most two short words and they all fit at the same large size. They
 * still read as the button's name, for Voice Control and WCAG's "label in name":
 * "Deflect" starts "Deflection", and "Turnover" is only split, with a hyphen.
 */
const GRID_WORDS: Partial<Record<StatType, readonly string[]>> = {
  tov: ['Turn-', 'over'],
  deflection: ['Deflect'],
};

/**
 * Labels are big, and all the same size, but the widest word on the grid must still
 * fit its button on one line. Measures every word once, with a canvas, in the label
 * font at the size labels render at when they fit (the xl token), and gives the
 * widest one to the CSS as `--label-em`, which caps the size so it fits the width.
 * Without a canvas (or if it won't take the label font), the CSS falls back to a
 * size that fits any label.
 */
function useFitLabels(gridRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const label = grid?.querySelector<HTMLElement>('[data-fit-label]');
    if (!grid || !label) return;
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return;

    const probe = document.createElement('span');
    probe.style.fontSize = 'var(--font-size-xl)';
    grid.append(probe);
    const size = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (!(size > 0)) return;

    const { fontStyle, fontWeight, fontFamily } = getComputedStyle(label);
    const words = Array.from(
      grid.querySelectorAll('[data-fit-word]'),
      (word) => word.textContent ?? '',
    );
    const font = `${fontStyle} ${fontWeight} ${size}px ${fontFamily}`;
    const widest = widestWordOnCanvas(context, font, size, words);
    if (widest !== undefined) grid.style.setProperty('--label-em', widest.toFixed(3));
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

/**
 * Each word on its own line, the same on every screen size ("2PT" over "Made"). A
 * word ending in a hyphen ("Turn-") runs into the next with no space between, so the
 * label's text is still the one word.
 */
function Words({ words }: { words: readonly string[] }) {
  return words.map((word, index) => (
    <Fragment key={index}>
      {index > 0 && !words[index - 1]?.endsWith('-') ? ' ' : null}
      <span className={styles.word} data-fit-word="">
        {word}
      </span>
    </Fragment>
  ));
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
        <Words words={GRID_WORDS[type] ?? label.split(' ')} />
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

const UndoButton = memo(function UndoButton({ onUndo }: { onUndo: () => boolean }) {
  return (
    <button
      type="button"
      className={cx(styles.button, styles.undo)}
      aria-label="Undo last stat"
      onClick={(event) => {
        // The second tap of a double tap is ignored, so it doesn't flash either.
        if (onUndo()) flash(event.currentTarget);
      }}
    >
      <span className={styles.label} data-fit-label="">
        <Words words={['Undo']} />
      </span>
    </button>
  );
});

export interface StatGridProps {
  counts: StatCounts;
  /** Records one stat. Keep it stable (useCallback), or every button re-renders. */
  onRecord: (type: StatType) => void;
  /**
   * Removes the most recent stat; returns false if it ignored the tap (e.g. the
   * second tap of a double tap). Keep it stable too.
   */
  onUndo: () => boolean;
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
