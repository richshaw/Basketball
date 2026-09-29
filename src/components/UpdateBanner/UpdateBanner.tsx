import { useState } from 'react';
import { Button } from '@/components/Button/Button';
import { useReloadSafe } from '@/data/hooks';
import { useServiceWorkerUpdate } from '@/pwa/serviceWorkerContext';
import styles from './UpdateBanner.module.css';

/**
 * Offers a new app version. Rendered only by AppShell (the tab screens), never on
 * the live game screen, because updating reloads the app. It stays away while a reload
 * would lose a tap the live game screen holds only in memory (useReloadSafe: not kept on
 * the phone yet, say), and comes back once it wouldn't.
 */
export function UpdateBanner() {
  const { needRefresh, update, dismiss } = useServiceWorkerUpdate();
  const reloadSafe = useReloadSafe();
  const [updating, setUpdating] = useState(false);

  // A reload that would lose taps meanwhile is held back (reloadIfSafe): once it's safe
  // again, the update is offered afresh rather than shown as still under way.
  if (updating && !reloadSafe) setUpdating(false);

  if (!needRefresh || !reloadSafe) return null;

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      // Resolves once the new version is told to take over; the page then reloads.
      await update();
    } catch (error) {
      console.error('App update failed', error);
      setUpdating(false);
    }
  };

  return (
    <aside className={styles.banner} aria-label="App update">
      <p className={styles.message} role="status">
        New version available
      </p>
      <div className={styles.actions}>
        <Button variant="ghost" onClick={dismiss} disabled={updating}>
          Later
        </Button>
        <Button onClick={handleUpdate} disabled={updating}>
          {updating ? 'Updating…' : 'Update'}
        </Button>
      </div>
    </aside>
  );
}
