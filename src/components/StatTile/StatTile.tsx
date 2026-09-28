import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './StatTile.module.css';

export interface StatTileProps {
  /** The big number, e.g. `14` or `"56%"`. Keep it to about four characters. */
  value: ReactNode;
  /** Short label under the number, e.g. "PTS". */
  label: string;
  /** Full name read by screen readers instead of `label`, e.g. "Points". */
  fullLabel?: string;
  /** Optional line under the label, e.g. "5/9 FG". */
  detail?: ReactNode;
  /** Draws the number in the accent color, for the headline stat. */
  highlight?: boolean;
  className?: string;
}

/**
 * A big number with a small label. Use inside a StatTileGrid: screen readers
 * hear "Points: 14" (a description-list term and its value).
 */
export function StatTile({
  value,
  label,
  fullLabel,
  detail,
  highlight = false,
  className,
}: StatTileProps) {
  return (
    <div className={cx(styles.tile, highlight && styles.highlight, className)}>
      <dt className={styles.label}>
        {fullLabel ? (
          <>
            <span aria-hidden="true">{label}</span>
            <span className="visually-hidden">{fullLabel}</span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className={styles.value}>{value}</dd>
      {detail ? <dd className={styles.detail}>{detail}</dd> : null}
    </div>
  );
}

export interface StatTileGridProps {
  /** StatTile elements. */
  children: ReactNode;
  /**
   * Fixed tiles per row. By default as many ~76px tiles as fit: 4 across on most
   * iPhones, 3 on the smallest. Pick 3 for longer values such as "45.5%".
   */
  columns?: 2 | 3 | 4;
  /** Names the group of stats for screen readers, e.g. "Game totals". */
  'aria-label'?: string;
  className?: string;
}

const columnClass = { 2: styles.columns2, 3: styles.columns3, 4: styles.columns4 } as const;

/** Grid of StatTiles (a description list). */
export function StatTileGrid({
  children,
  columns,
  'aria-label': ariaLabel,
  className,
}: StatTileGridProps) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cx(styles.grid, columns && columnClass[columns], className)}
    >
      {children}
    </dl>
  );
}
