import { useSyncExternalStore } from 'react';

/**
 * The sheets that are open right now, bottom to top. While any is open the page
 * behind can't scroll, and toasts render inside the top one: a modal dialog makes
 * everything outside it inert, so a toast anywhere else couldn't be seen or tapped.
 */

let outlets: readonly HTMLElement[] = [];
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

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getTopOutlet(): HTMLElement | null {
  return outlets.at(-1) ?? null;
}

/** The element toasts should render into: inside the top open sheet, or null when none is open. */
export function useTopSheetOutlet(): HTMLElement | null {
  return useSyncExternalStore(subscribe, getTopOutlet, () => null);
}
