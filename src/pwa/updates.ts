/** How long to wait for the new version to take control before reloading anyway. */
export const TAKEOVER_TIMEOUT_MS = 5000;

export interface ApplyUpdateOptions {
  /** `navigator.serviceWorker`, or undefined where service workers aren't supported. */
  container: ServiceWorkerContainer | undefined;
  /** Tells the waiting worker to take over (vite-plugin-pwa's `updateServiceWorker`). */
  activateWaitingWorker: () => Promise<void>;
  reload: () => void;
  /**
   * Whether this window may reload now, losing nothing (isReloadSafe): if not, the
   * waiting worker isn't even told to take over. Yes, if left out.
   */
  mayReload?: () => boolean;
}

/**
 * Moves this window to the new version: activates the waiting service worker, then
 * reloads once it controls the page. Only the window that asked reloads; any other
 * window (a live game in another tab, say) keeps running until it reloads by itself.
 * Nothing happens while this window couldn't reload (`mayReload`): the new worker's
 * activation deletes the old version's cached files, which the window would then carry
 * on without (they're what it runs on offline).
 */
export async function applyUpdate({
  container,
  activateWaitingWorker,
  reload,
  mayReload = () => true,
}: ApplyUpdateOptions): Promise<void> {
  const registration = await container?.getRegistration();
  if (!container || !registration?.waiting) {
    // Nothing is waiting: the new version already took over (e.g. from another
    // window), so a reload is all it takes to run it.
    reload();
    return;
  }
  // (Checked last thing before the worker is told: vite-plugin-pwa's updateServiceWorker
  // only sends it SKIP_WAITING, and from then on the old version's files are going.)
  if (!mayReload()) return;

  let reloaded = false;
  const reloadOnce = () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  };
  container.addEventListener('controllerchange', reloadOnce, { once: true });
  // Never leave the user stuck on "Updating…" if control doesn't change hands.
  setTimeout(reloadOnce, TAKEOVER_TIMEOUT_MS);

  await activateWaitingWorker();
}

/**
 * Calls `onTakeover` when a new version takes control of this window while it still
 * runs the old code (the user updated from another window). The window carries on
 * untouched, but can offer the update again, which by then is just a reload.
 */
export function watchForTakeover(
  container: ServiceWorkerContainer | undefined,
  onTakeover: () => void,
): () => void {
  if (!container) return () => {};
  let controller = container.controller;
  const handleControllerChange = () => {
    const previous = controller;
    controller = container.controller;
    // The first version claiming a fresh page isn't a takeover: the page already runs it.
    if (previous) onTakeover();
  };
  container.addEventListener('controllerchange', handleControllerChange);
  return () => container.removeEventListener('controllerchange', handleControllerChange);
}
