import { useSyncExternalStore } from 'react';

/**
 * The sheets that are open right now, bottom to top. While any is open the page
 * behind can't scroll, and toasts render inside the top one: a modal dialog makes
 * everything outside it inert, so a toast anywhere else couldn't be seen or tapped.
 * There a toast takes room of its own, under the sheet's header, so it never covers
 * what the sheet holds; and a sheet that opens clears the toast shown before it (see
 * ToastProvider.tsx).
 */

const NO_SHEETS: readonly HTMLElement[] = [];
let outlets: readonly HTMLElement[] = NO_SHEETS;
const listeners = new Set<() => void>();
let pageOverflow = '';

function notify() {
  for (const listener of listeners) listener();
}

/** Called by Sheet when it opens. Returns the function to call when it closes. */
export function registerOpenSheet(toastOutlet: HTMLElement): () => void {
  if (outlets.length === 0) {
    const root = document.documentElement;
    pageOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
  }
  outlets = [...outlets, toastOutlet];
  notify();

  return () => {
    if (!outlets.includes(toastOutlet)) return;
    outlets = outlets.filter((outlet) => outlet !== toastOutlet);
    if (outlets.length === 0) document.documentElement.style.overflow = pageOverflow;
    notify();
  };
}

/** The <dialog> of the sheet on top, if one is open. */
export function topOpenSheet(): HTMLDialogElement | null {
  return outlets.at(-1)?.closest('dialog') ?? null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getOutlets(): readonly HTMLElement[] {
  return outlets;
}

/**
 * The toast outlets of the open sheets, bottom to top: toasts render into the last one
 * (the top sheet), or on the page when there's none. A new array each time a sheet opens
 * or closes, the same one otherwise.
 */
export function useOpenSheets(): readonly HTMLElement[] {
  return useSyncExternalStore(subscribe, getOutlets, () => NO_SHEETS);
}
