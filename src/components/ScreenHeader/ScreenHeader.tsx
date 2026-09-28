import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeftIcon } from '@/components/Icons/Icons';
import styles from './ScreenHeader.module.css';

export interface ScreenHeaderProps {
  title: string;
  /** Shows a back link to this path. Build it with `paths.*` from src/routes.ts. */
  backTo?: string;
  /** Back link text. The iOS convention is the previous screen's title. */
  backLabel?: string;
  /** Optional control on the right, e.g. a ghost Button. */
  action?: ReactNode;
}

/**
 * Sticky screen header with an iOS-style large title. It pads itself below the
 * status bar (safe-area inset), so screens must not add their own top padding.
 */
export function ScreenHeader({ title, backTo, backLabel = 'Back', action }: ScreenHeaderProps) {
  const actionSlot = action ? <div className={styles.action}>{action}</div> : null;

  return (
    <header className={styles.header}>
      {backTo ? (
        <div className={styles.bar}>
          <Link to={backTo} className={styles.back}>
            <ChevronLeftIcon className={styles.backIcon} />
            <span>{backLabel}</span>
          </Link>
          {actionSlot}
        </div>
      ) : null}
      <div className={styles.titleRow}>
        <h1 className={styles.title}>{title}</h1>
        {backTo ? null : actionSlot}
      </div>
    </header>
  );
}
