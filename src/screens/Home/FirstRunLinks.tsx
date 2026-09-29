import { useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router';
import { useToast } from '@/components/Toast/toastContext';
import { isCloudBackupAvailable } from '@/data/backup/cloudBackup';
import { addSampleData } from '@/data/demo';
import { savePlayer } from '@/data/repo';
import { paths } from '@/routes';
import type { PlayerSetupCardHandle } from './PlayerSetupCard';
import styles from './FirstRunLinks.module.css';

export interface FirstRunLinksProps {
  /** "Setting up a new phone? Restore from a backup": while the player isn't set up. */
  restore?: boolean;
  /** "Just looking? Try it with sample data": while there are no games. */
  sampleData?: boolean;
  /**
   * The setup card, while it's on screen: a name or number typed on it but not saved
   * yet is saved before the sample games are added, so they're hers and nothing she
   * typed is lost.
   */
  setupCard?: RefObject<PlayerSetupCardHandle | null>;
}

/**
 * Quiet ways in, under New game on a phone that's just starting: small lines that never
 * compete with it (or with the setup card's Save). Restoring from a backup, and adding
 * the sample games to look around (for the player the parent set up, if she did, even
 * one only typed on the setup card; see addSampleData).
 */
export function FirstRunLinks({
  restore = false,
  sampleData = false,
  setupCard,
}: FirstRunLinksProps) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  const trySampleData = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      const unsaved = setupCard?.current?.unsavedPlayer();
      if (unsaved) await savePlayer(unsaved);
      const added = await addSampleData();
      toast.show({
        message: added
          ? 'Sample games added. You can remove them in Settings.'
          : 'This phone has games of its own now, so nothing was added.',
      });
    } catch (error) {
      console.error('Adding sample data failed', error);
      toast.show({ message: "Couldn't add the sample games. Try again." });
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  if (!restore && !sampleData) return null;
  return (
    <div className={styles.links}>
      {/* With cloud backup, its code is the way back on a new phone (backup files are there too). */}
      {restore && isCloudBackupAvailable() ? (
        <p className={styles.line}>
          Setting up a new phone?{' '}
          <Link to={paths.restoreBackup('games')} className={styles.link}>
            Restore from a backup
          </Link>
        </p>
      ) : null}
      {restore && !isCloudBackupAvailable() ? (
        <p className={styles.line}>
          Restoring from a backup?{' '}
          <Link to={paths.settings} className={styles.link}>
            Go to Settings
          </Link>
        </p>
      ) : null}
      {sampleData ? (
        <p className={styles.line}>
          Just looking?{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => void trySampleData()}
            disabled={adding}
          >
            Try it with sample data
          </button>
        </p>
      ) : null}
    </div>
  );
}
