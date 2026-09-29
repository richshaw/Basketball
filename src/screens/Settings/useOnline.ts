import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** `navigator.onLine`: false only when the phone knows it has no connection. */
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Whether the phone has a connection (`navigator.onLine`), kept up to date as it comes
 * and goes. It can't tell whether a given server answers: with a connection, the backup
 * server may still be out of reach.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true);
}
