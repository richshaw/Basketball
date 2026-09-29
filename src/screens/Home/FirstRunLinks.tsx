import { useRef, useState } from 'react';
import { useToast } from '@/components/Toast/toastContext';
import { addSampleData } from '@/data/demo';
import styles from './FirstRunLinks.module.css';

/**
 * Quiet ways in for a phone with no games yet, under New game: small lines that never
 * compete with it. "Just looking? Try it with sample data" adds the sample games (for
 * the player the parent set up, if she did; see addSampleData).
 */
export function FirstRunLinks() {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);

  const trySampleData = async () => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
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

  return (
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
  );
}
