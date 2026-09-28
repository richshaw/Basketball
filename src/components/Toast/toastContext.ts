import { createContext, useContext } from 'react';

export interface ToastOptions {
  /** Short text, e.g. "2PT made". One line reads best. */
  message: string;
  /** Label of an optional action button, e.g. "Undo". */
  actionLabel?: string;
  /** Runs when the action is tapped (the toast hides first). */
  onAction?: () => void;
  /** Milliseconds before it hides on its own. Defaults to 4000; `Infinity` keeps it up. */
  duration?: number;
}

export interface Toaster {
  /** Shows a toast right away, replacing the one on screen. Returns its id. */
  show: (options: ToastOptions) => number;
  /** Hides the toast with this id (if it's still showing), or whatever toast is showing. */
  hide: (id?: number) => void;
}

export const ToastContext = createContext<Toaster | null>(null);

/**
 * `const toast = useToast(); toast.show({ message: '2PT made', actionLabel: 'Undo', onAction })`.
 * Needs the ToastProvider that App mounts. The returned object never changes, so it
 * is safe in effect dependencies and won't re-render the caller.
 */
export function useToast(): Toaster {
  const toaster = useContext(ToastContext);
  if (!toaster) throw new Error('useToast() needs a <ToastProvider> above it (see App.tsx).');
  return toaster;
}
