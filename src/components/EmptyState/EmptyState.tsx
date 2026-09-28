import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  /** An emoji or icon above the title. Decorative: hidden from screen readers. */
  icon?: ReactNode;
  title: string;
  message?: ReactNode;
  /** Optional call to action, e.g. a Button or ButtonLink. */
  action?: ReactNode;
}

/** Friendly placeholder for a screen or list with nothing to show yet. */
export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  return (
    <div className={styles.emptyState}>
      {icon ? (
        <div className={styles.icon} aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h2 className={styles.title}>{title}</h2>
      {message ? <p className={styles.message}>{message}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
