import { useState } from 'react';
import { Button } from '@/components/Button/Button';
import { useServiceWorkerUpdate } from '@/pwa/serviceWorkerContext';
import styles from './UpdateBanner.module.css';

/**
 * Offers a new app version. Rendered only by AppShell (the tab screens), never on
 * the live game screen, because updating reloads the app.
 */
export function UpdateBanner() {
  const { needRefresh, update, dismiss } = useServiceWorkerUpdate();
  const [updating, setUpdating] = useState(false);

  if (!needRefresh) return null;

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
