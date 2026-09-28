import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Name the group for screen readers with `aria-label` or `aria-labelledby` (one is required). */
type GroupLabel =
  | { 'aria-label': string; 'aria-labelledby'?: never }
  | { 'aria-labelledby': string; 'aria-label'?: never };

export type SegmentedControlProps<T extends string> = GroupLabel & {
  /** Two to four short options work best; every segment gets the same width. */
  options: readonly SegmentedOption<T>[];
  /** The selected option's value. */
  value: T;
  /** Called with the newly selected value (not when the selected segment is tapped again). */
  onChange: (value: T) => void;
  /** `md` is 44px tall (forms, filters); `lg` is 56px for a screen's main choice. */
  size?: 'md' | 'lg';
  className?: string;
};

/** Where each key moves the selection, wrapping around at the ends. */
function targetIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * iOS-style segmented control: pick exactly one of a few options. It is a radio
 * group for assistive tech; Tab reaches the selected segment and the arrow keys
 * (plus Home/End) move the selection.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  ...groupLabel
}: SegmentedControlProps<T>) {
  const segments = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    segments.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = segments.current.findIndex((segment) => segment === event.target);
    if (current === -1) return;
    const next = targetIndex(event.key, current, options.length);
    if (next === null) return;
    event.preventDefault();
    select(next);
  };

  // Custom properties position the sliding thumb under the selected segment.
  const thumbPosition = {
    '--segment-count': options.length,
    '--segment-index': selectedIndex,
  } as CSSProperties;

  return (
    <div
      role="radiogroup"
      {...groupLabel}
      className={cx(styles.control, styles[size], className)}
      style={thumbPosition}
      onKeyDown={handleKeyDown}
    >
      {selectedIndex === -1 ? null : <span className={styles.thumb} aria-hidden="true" />}
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        // Roving focus: only one segment is in the tab order (the selected one, else the first).
        const tabbable = selectedIndex === -1 ? index === 0 : selected;
        return (
          <button
            key={option.value}
            ref={(segment) => {
              segments.current[index] = segment;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={tabbable ? 0 : -1}
            className={cx(styles.segment, selected && styles.selected)}
            onClick={() => select(index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
