import { useId, type ReactNode } from 'react';
import styles from './ReportSection.module.css';

export interface ReportSectionProps {
  /** Heading, e.g. "Shooting". Also names the section for screen readers. */
  title: string;
  /** A short line under the heading, e.g. "Tap a play to delete it." */
  note?: ReactNode;
  children: ReactNode;
}

/** One titled part of the game report (a named region with an h2). */
export function ReportSection({ title, note, children }: ReportSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={styles.heading}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}
