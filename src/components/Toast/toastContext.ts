import { createContext, useContext, useLayoutEffect } from 'react';

/**
 * - `bottom` (default): above the home indicator, and above the tab bar and update
 *   banner on tab screens.
 * - `top`: under the screen's back-button bar, for screens whose bottom edge is full
 *   of controls. (The live game screen shows its feedback inline instead: see CLAUDE.md.)
 */
export type ToastPlacement = 'bottom' | 'top';

interface ToastContent {
  /** Short text, e.g. "2PT made". One line reads best. */
  message: string;
  /** Milliseconds before it hides on its own. Defaults to 4000; `Infinity` keeps it up. */
  duration?: number;
  /** Where it floats; see ToastPlacement. Inside an open sheet it sits under the header. */
  placement?: ToastPlacement;
}

/** An action button, e.g. Undo: label and handler come together. */
type ToastAction =
  | {
      /** Label of the action button, e.g. "Undo". */
      actionLabel: string;
      /** Runs once when the action is tapped; the toast then fades away. */
      onAction: () => void;
    }
  | { actionLabel?: never; onAction?: never };

export type ToastOptions = ToastContent & ToastAction;

export interface Toaster {
  /**
   * Shows a toast, replacing the one on screen. (Right after a toast's action was
   * tapped, the next one waits until it's gone, so a double tap can't hit it.)
   * Returns its id.
   */
  show: (options: ToastOptions) => number;
  /** Hides the toast with this id (on screen or waiting), or every toast if no id is given. */
  hide: (id?: number) => void;
}

export const ToastContext = createContext<Toaster | null>(null);

/**
 * `const toast = useToast(); toast.show({ message: 'Saved' })`. Needs the
 * ToastProvider that App mounts. The returned object never changes, so it is safe
 * in effect dependencies and won't re-render the caller.
 */
export function useToast(): Toaster {
  const toaster = useContext(ToastContext);
  if (!toaster) throw new Error('useToast() needs a <ToastProvider> above it (see App.tsx).');
  return toaster;
}

/** Keeps toasts off the screen until the function it returns is called (see useNoToasts). */
export type BlockToasts = () => () => void;

export const ToastBlockContext = createContext<BlockToasts | null>(null);

/**
 * For a screen that must never show a toast: the live game screen, whose own controls
 * fill its bottom edge (it says everything on its last-action line instead). While a
 * component calling it is mounted, the toast on screen goes at once as it mounts (one
 * shown by the screen before it, like "Game deleted"), with any waiting, and a toast
 * shown meanwhile, from anywhere, never appears. Toasts show again once it's gone.
 */
export function useNoToasts(): void {
  const block = useContext(ToastBlockContext);
  if (!block) throw new Error('useNoToasts() needs a <ToastProvider> above it (see App.tsx).');
  // Before the screen is painted, so the toast never shows on it, not even for a frame.
  useLayoutEffect(() => block(), [block]);
}
