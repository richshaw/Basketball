import { useId, type ReactNode, type Ref } from 'react';
import styles from './ReportSection.module.css';

export interface ReportSectionProps {
  /** Heading, e.g. "Shooting". Also names the section for screen readers. */
  title: string;
  /** A short line under the heading, e.g. "Tap a play to delete it." */
  note?: ReactNode;
  /**
   * The heading element, e.g. to move focus there when what had it is gone. Passing
   * one makes the heading focusable from script (not with Tab).
   */
  headingRef?: Ref<HTMLHeadingElement>;
  /** The heading's id, e.g. for something in the section to be named by it. */
  headingId?: string;
  children: ReactNode;
}

/** One titled part of the game report (a named region with an h2). */
export function ReportSection({
  title,
  note,
  headingRef,
  headingId: givenHeadingId,
  children,
}: ReportSectionProps) {
  const generatedHeadingId = useId();
  const headingId = givenHeadingId ?? generatedHeadingId;
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={styles.heading}>
        <h2
          ref={headingRef}
          id={headingId}
          className={styles.title}
          tabIndex={headingRef ? -1 : undefined}
        >
          {title}
        </h2>
        {note ? <p className={styles.note}>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}
