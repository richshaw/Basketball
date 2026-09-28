import { useEffect } from 'react';
import { useLocation, useRouteError } from 'react-router';
import { Button } from '@/components/Button/Button';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useServiceWorkerUpdate } from '@/pwa/serviceWorkerContext';
import { paths } from '@/routes';
import styles from './ErrorScreen.module.css';

/**
 * Shown instead of a screen that crashed while rendering. A crashed tab screen shows
 * it inside the shell, so the tab bar still works; other routes show it full screen.
 * It always offers a way out: the waiting update (often the fix), Games, or a reload.
 */
export function ErrorScreen() {
  const error = useRouteError();
  const onGames = useLocation().pathname === paths.home;
  const { needRefresh, update } = useServiceWorkerUpdate();

  useEffect(() => {
    console.error('Screen crashed', error);
  }, [error]);

  const updateApp = () => {
    update().catch((updateError: unknown) => {
      console.error('App update failed', updateError);
    });
  };

  return (
    <main>
      <ScreenHeader title="Hoop Stats" />
      <ScreenBody>
        <EmptyState
          icon="🤕"
          title="Something went wrong"
          message="Anything already saved stays on this phone."
          action={
            <div className={styles.actions}>
              {needRefresh ? (
                <Button size="lg" block onClick={updateApp}>
                  Update app
                </Button>
              ) : null}
              {onGames ? null : (
                <ButtonLink
                  to={paths.home}
                  size="lg"
                  block
                  variant={needRefresh ? 'secondary' : 'primary'}
                >
                  Go to Games
                </ButtonLink>
              )}
              <Button
                size="lg"
                block
                variant={needRefresh || !onGames ? 'ghost' : 'primary'}
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </div>
          }
        />
      </ScreenBody>
    </main>
  );
}
