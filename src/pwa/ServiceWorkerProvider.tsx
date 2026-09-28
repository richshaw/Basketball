import { useMemo, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ServiceWorkerContext, type ServiceWorkerUpdate } from './serviceWorkerContext';

/** How often an app left open checks for a new version. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function scheduleUpdateChecks(registration: ServiceWorkerRegistration) {
  setInterval(() => {
    if (!navigator.onLine) return;
    registration.update().catch(() => {
      // No signal or a server hiccup: try again at the next interval.
    });
  }, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * Registers the service worker once for the whole app and shares its update
 * state. Only the tab-screen shell shows the prompt (UpdateBanner), so a new
 * version never interrupts a live game.
 */
export function ServiceWorkerProvider({ children }: { children: ReactNode }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) scheduleUpdateChecks(registration);
    },
    onRegisterError(error: unknown) {
      console.error('Service worker registration failed', error);
    },
  });

  const value = useMemo<ServiceWorkerUpdate>(
    () => ({
      needRefresh,
      update: () => updateServiceWorker(true),
      dismiss: () => setNeedRefresh(false),
    }),
    [needRefresh, setNeedRefresh, updateServiceWorker],
  );

  return <ServiceWorkerContext value={value}>{children}</ServiceWorkerContext>;
}
