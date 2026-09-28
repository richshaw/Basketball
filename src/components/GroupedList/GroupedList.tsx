import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './GroupedList.module.css';

export interface GroupedListProps {
  /** Section title above the rows (small and muted, iOS style). Also names the list. */
  header?: ReactNode;
  /** Note under the rows, e.g. what a setting does. */
  footer?: ReactNode;
  /** Heading level of `header`. Defaults to 2: a section of a screen whose title is the h1. */
  headingLevel?: 2 | 3 | 4;
  /** Names the list for screen readers when there is no header. */
  'aria-label'?: string;
  /** ListRow elements. */
  children: ReactNode;
  className?: string;
}

/**
 * iOS "inset grouped" list: a rounded block of ListRows with an optional header
 * and footer. Consecutive groups are spaced apart automatically.
 */
export function GroupedList({
  header,
  footer,
  headingLevel = 2,
  'aria-label': ariaLabel,
  children,
  className,
}: GroupedListProps) {
  const headerId = useId();
  const Heading = `h${headingLevel}` as const;

  return (
    <div className={cx(styles.group, className)}>
      {header ? (
        <Heading id={headerId} className={styles.header}>
          {header}
        </Heading>
      ) : null}
      {/* role="list": Safari drops list semantics from lists styled with list-style: none. */}
      <ul
        role="list"
        className={styles.list}
        aria-labelledby={header ? headerId : undefined}
        aria-label={header ? undefined : ariaLabel}
      >
        {children}
      </ul>
      {footer ? <p className={styles.footer}>{footer}</p> : null}
    </div>
  );
}
