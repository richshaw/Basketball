import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { Button } from '@/components/Button/Button';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import styles from './ErrorScreen.module.css';

/** Shown instead of a screen that crashed while rendering (root route error boundary). */
export function ErrorScreen() {
  const error = useRouteError();

  useEffect(() => {
    console.error('Screen crashed', error);
  }, [error]);

  return (
    <main>
      <ScreenHeader title="Hoop Stats" />
      <div className={styles.body}>
        <EmptyState
          icon="🤕"
          title="Something went wrong"
          message="Reload to keep going. Anything already saved stays on this phone."
          action={
            <Button size="lg" onClick={() => window.location.reload()}>
              Reload
            </Button>
          }
        />
      </div>
    </main>
  );
}
