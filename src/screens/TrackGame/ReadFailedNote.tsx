import styles from './ReadFailedNote.module.css';

export interface ReadFailedNoteProps {
  /**
   * A reload would lose nothing (every tap and spot not saved yet, of any game, is kept
   * on this phone, and no Undo or period move is still being saved): it says the taps are
   * kept, and offers Reload. Otherwise it asks to keep the app open instead.
   */
  canReload: boolean;
}

/**
 * "Can't read saved stats right now": shown over the stat strip while the saved stats
 * can't be read (e.g. WebKit lost its IndexedDB connection in the background). The
 * screen stays up with the stats it read last, and taps still count and are kept; the
 * reads are tried again on their own. Calm, since nothing is lost: a polite status, not
 * an alert. Reload (which the journals make safe) only ever happens on the parent's tap.
 */
export function ReadFailedNote({ canReload }: ReadFailedNoteProps) {
  return (
    <div className={styles.row}>
      <p role="status" className={styles.message}>
        <span className={styles.title}>Can&apos;t read saved stats right now.</span>{' '}
        <span className={styles.hint}>
          {canReload
            ? 'Your taps are kept on this phone.'
            : 'Keep the app open until your taps are saved.'}
        </span>
      </p>
      {canReload ? (
        <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
          Reload
        </button>
      ) : null}
    </div>
  );
}
