import styles from './ReadFailedNote.module.css';

export interface ReadFailedNoteProps {
  /**
   * Every tap not saved yet is kept on this phone, so a reload loses none: it says so,
   * and offers Reload. Otherwise it asks to keep the app open instead.
   */
  kept: boolean;
}

/**
 * "Can't read saved stats right now": shown over the stat strip while the saved stats
 * can't be read (e.g. WebKit lost its IndexedDB connection in the background). The
 * screen stays up with the stats it read last, and taps still count and are kept; the
 * reads are tried again on their own. Calm, since nothing is lost: a polite status, not
 * an alert. Reload (which the journal makes safe) only ever happens on the parent's tap.
 */
export function ReadFailedNote({ kept }: ReadFailedNoteProps) {
  return (
    <div className={styles.row}>
      <p role="status" className={styles.message}>
        <span className={styles.title}>Can&apos;t read saved stats right now.</span>{' '}
        <span className={styles.hint}>
          {kept
            ? 'Your taps are kept on this phone.'
            : 'Keep the app open until your taps are saved.'}
        </span>
      </p>
      {kept ? (
        <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
          Reload
        </button>
      ) : null}
    </div>
  );
}
