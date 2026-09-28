import type { MouseEventHandler, ReactNode } from 'react';
import { Link, type To } from 'react-router';
import { ChevronRightIcon } from '@/components/Icons/Icons';
import { cx } from '@/lib/cx';
import styles from './GroupedList.module.css';

interface ListRowContentProps {
  title: ReactNode;
  /** Second line in smaller, muted text, e.g. "Sat, Oct 12 · Home". */
  subtitle?: ReactNode;
  /** Right-side detail: a short value ("W 42–38", "v1.2") or a Badge. */
  value?: ReactNode;
  /** Emoji or icon before the title. Decorative: hidden from screen readers. */
  icon?: ReactNode;
  /** Show a › at the end. Defaults to true for link rows and false otherwise. */
  chevron?: boolean;
  /** Red title, for rows that delete or reset something. */
  destructive?: boolean;
  /** Class name for the row's <li>. */
  className?: string;
}

type ListRowAction =
  | {
      /** Makes the row a router link. Build the path with `paths.*` from src/routes.ts. */
      to: To;
      onClick?: never;
      disabled?: never;
    }
  | {
      to?: never;
      /** Makes the row a button. */
      onClick: MouseEventHandler<HTMLButtonElement>;
      disabled?: boolean;
    }
  | { to?: never; onClick?: never; disabled?: never };

export type ListRowProps = ListRowContentProps & ListRowAction;

const hasValue = (value: ReactNode) =>
  value !== undefined && value !== null && value !== false && value !== '';

/**
 * One row of a GroupedList. With `to` it's a link, with `onClick` a button, and
 * with neither a static row (e.g. a label and its value).
 */
export function ListRow({
  title,
  subtitle,
  value,
  icon,
  chevron,
  destructive = false,
  className,
  to,
  onClick,
  disabled,
}: ListRowProps) {
  const interactive = to !== undefined || onClick !== undefined;
  const rowClassName = cx(
    styles.row,
    interactive && styles.interactive,
    destructive && styles.destructive,
  );

  const content = (
    <>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {hasValue(value) ? <span className={styles.value}>{value}</span> : null}
      {(chevron ?? to !== undefined) ? <ChevronRightIcon className={styles.chevron} /> : null}
    </>
  );

  let row: ReactNode;
  if (to !== undefined) {
    row = (
      <Link to={to} className={rowClassName}>
        {content}
      </Link>
    );
  } else if (onClick) {
    row = (
      <button type="button" className={rowClassName} onClick={onClick} disabled={disabled}>
        {content}
      </button>
    );
  } else {
    row = <div className={rowClassName}>{content}</div>;
  }

  return <li className={cx(styles.item, Boolean(icon) && styles.withIcon, className)}>{row}</li>;
}
