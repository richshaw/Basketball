/**
 * Reloading the page, only ever while that would lose nothing.
 *
 * A reload forgets whatever only this page holds in memory: a tap, spot or Undo on the
 * live game screen that its journal couldn't keep, say (see isReloadSafe in
 * src/data/pendingStats.ts). Every reload in the app goes through reloadIfSafe: the Reload
 * buttons (the error screen's, and the live game screen's while it can't read the saved
 * stats) and the app update's (applyUpdate, from ServiceWorkerProvider). The buttons are
 * offered only while it's safe (useReloadSafe in src/data/hooks.ts); this checks again at
 * the moment of the reload, so a tap held back meanwhile is never lost.
 */
import { isReloadSafe } from '@/data/pendingStats';

/** Reloads the page. */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * Reloads the page (`reload`, reloadPage by default) if that would lose nothing, and says
 * whether it did. When it wouldn't, nothing happens: the screen offers it again once it's
 * safe (an app update is offered again by the tab screens' banner).
 */
export function reloadIfSafe(reload: () => void = reloadPage): boolean {
  if (!isReloadSafe()) return false;
  reload();
  return true;
}
