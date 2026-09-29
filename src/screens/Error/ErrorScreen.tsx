import { useEffect } from 'react';
import { useLocation, useRouteError } from 'react-router';
import { Button } from '@/components/Button/Button';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useReloadSafe } from '@/data/hooks';
import { useServiceWorkerUpdate } from '@/pwa/serviceWorkerContext';
import { paths } from '@/routes';
import styles from './ErrorScreen.module.css';

/**
 * Shown instead of a screen that crashed while rendering. A crashed tab screen shows
 * it inside the shell, so the tab bar still works; other routes show it full screen.
 * It offers a way out: the waiting update (often the fix), Games, or a reload. The
 * update and the reload reload the page, so they're offered only while that would lose
 * nothing (useReloadSafe: a live game screen's taps not kept on the phone yet, say);
 * meanwhile it asks to keep the app open, and offers them as soon as they're safe.
 */
export function ErrorScreen() {
  const error = useRouteError();
  const onGames = useLocation().pathname === paths.home;
  const { needRefresh, update } = useServiceWorkerUpdate();
  const reloadSafe = useReloadSafe();
  const offerUpdate = needRefresh && reloadSafe;

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
          message={
            reloadSafe
              ? 'Anything already saved stays on this phone.'
              : 'Anything already saved stays on this phone. Keep the app open until your taps are saved.'
          }
          action={
            onGames && !reloadSafe ? null : (
              <div className={styles.actions}>
                {offerUpdate ? (
                  <Button size="lg" block onClick={updateApp}>
                    Update app
                  </Button>
                ) : null}
                {onGames ? null : (
                  <ButtonLink
                    to={paths.home}
                    size="lg"
                    block
                    variant={offerUpdate ? 'secondary' : 'primary'}
                  >
                    Go to Games
                  </ButtonLink>
                )}
                {reloadSafe ? (
                  <Button
                    size="lg"
                    block
                    variant={offerUpdate || !onGames ? 'ghost' : 'primary'}
                    onClick={() => window.location.reload()}
                  >
                    Reload
                  </Button>
                ) : null}
              </div>
            )
          }
        />
      </ScreenBody>
    </main>
  );
}
