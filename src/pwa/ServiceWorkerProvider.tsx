import { useEffect, useMemo, type ReactNode } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ServiceWorkerContext, type ServiceWorkerUpdate } from './serviceWorkerContext';
import { applyUpdate, watchForTakeover } from './updates';

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

const serviceWorkers = () => ('serviceWorker' in navigator ? navigator.serviceWorker : undefined);

/**
 * Registers the service worker once for the whole app and shares its update
 * state. Only the tab-screen shell shows the prompt (UpdateBanner), and only the
 * window where the user taps Update reloads, so a new version never interrupts a
 * live game.
 */
export function ServiceWorkerProvider({ children }: { children: ReactNode }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // By default the plugin reloads every open window when a new version takes
    // control, including one showing a live game. applyUpdate() reloads just the
    // window that asked.
    onNeedReload: () => {},
    onRegisteredSW(_swUrl, registration) {
      if (registration) scheduleUpdateChecks(registration);
    },
    onRegisterError(error: unknown) {
      console.error('Service worker registration failed', error);
    },
  });

  // Updated from another window: this one still runs the old version, so offer the update.
  useEffect(() => watchForTakeover(serviceWorkers(), () => setNeedRefresh(true)), [setNeedRefresh]);

  const value = useMemo<ServiceWorkerUpdate>(
    () => ({
      needRefresh,
      update: () =>
        applyUpdate({
          container: serviceWorkers(),
          activateWaitingWorker: () => updateServiceWorker(),
          reload: () => window.location.reload(),
        }),
      dismiss: () => setNeedRefresh(false),
    }),
    [needRefresh, setNeedRefresh, updateServiceWorker],
  );

  return <ServiceWorkerContext value={value}>{children}</ServiceWorkerContext>;
}
