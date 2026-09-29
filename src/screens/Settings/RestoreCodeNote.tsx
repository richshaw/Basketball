import { AlertIcon } from '@/components/Icons/Icons';
import { BackupCodeBlock } from './BackupCodeBlock';
import styles from './RestoreCodeNote.module.css';

export interface RestoreCodeNoteProps {
  /**
   * This phone's own backup code, when restoring switches it to the one entered (the
   * phone then forgets it); undefined when the phone has no code, or the same one.
   */
  switchingFrom?: string;
}

/**
 * Said before a restore from a backup code: this phone backs up with that code from now
 * on. When that means switching codes, a warning, with the current code to save first.
 */
export function RestoreCodeNote({ switchingFrom }: RestoreCodeNoteProps) {
  if (!switchingFrom) {
    return <p className={styles.note}>After restoring, this phone backs up with this code.</p>;
  }
  return (
    <div className={styles.switching}>
      <p className={styles.title}>
        <AlertIcon className={styles.icon} />
        This phone will switch backup codes
      </p>
      <p className={styles.text}>
        After restoring, it backs up with the code you entered and forgets its current one, the only
        way to restore its own online backup. Save the current code first if you might need that
        backup:
      </p>
      <BackupCodeBlock code={switchingFrom} size="md" />
    </div>
  );
}
