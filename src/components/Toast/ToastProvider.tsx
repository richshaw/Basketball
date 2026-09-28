import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTopSheetOutlet } from '@/components/Sheet/sheetStack';
import { cx } from '@/lib/cx';
import { ToastContext, type Toaster, type ToastOptions } from './toastContext';
import styles from './Toast.module.css';

const DEFAULT_DURATION_MS = 4000;
/**
 * A toast on its way out (its action was tapped, it timed out or was hidden) stays
 * this long, fading, with its action button still taking taps but ignoring them, so
 * the second tap of a double tap can't land on whatever is underneath.
 */
export const TOAST_EXIT_MS = 350;
/** While keyboard focus is inside a toast it stays up; this is how often it checks again. */
const FOCUS_RECHECK_MS = 1000;

interface ActiveToast {
  id: number;
  options: ToastOptions;
}

interface State {
  current: ActiveToast | null;
  /** `current` is fading out and ignoring taps. */
  leaving: boolean;
  /** Shown once the leaving toast is gone. */
  next: ActiveToast | null;
}

type Action =
  | { type: 'show'; toast: ActiveToast }
  | { type: 'hide'; id?: number }
  | { type: 'remove'; id: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'show':
      // Never swap a new toast in under a finger that just tapped the old one.
      return state.leaving
        ? { ...state, next: action.toast }
        : { current: action.toast, leaving: false, next: null };
    case 'hide': {
      const everything = action.id === undefined;
      const next = everything || state.next?.id === action.id ? null : state.next;
      const leaving =
        state.leaving || (state.current !== null && (everything || state.current.id === action.id));
      return next === state.next && leaving === state.leaving ? state : { ...state, next, leaving };
    }
    case 'remove':
      return state.current?.id === action.id
        ? { current: state.next, leaving: false, next: null }
        : state;
  }
}

const initialState: State = { current: null, leaving: false, next: null };

/**
 * Owns the one toast on screen and gives `useToast()` to everything inside it.
 * Mounted once, at the app root. The toast floats without moving the layout, and
 * only its action button takes taps.
 *
 * The live region is created once and moved, never re-created: into the top open
 * sheet (a modal makes the rest of the page inert), and back to the page when it
 * closes. So screen readers always announce new toasts.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const lastId = useRef(0);
  const actedOn = useRef<number | null>(null);
  const toastRef = useRef<HTMLDivElement>(null);

  const toaster = useMemo<Toaster>(
    () => ({
      show: (options) => {
        lastId.current += 1;
        dispatch({ type: 'show', toast: { id: lastId.current, options } });
        return lastId.current;
      },
      hide: (id) => dispatch({ type: 'hide', id }),
    }),
    [],
  );

  const { current, leaving } = state;

  // Hide after the duration, but not while keyboard focus is inside (so Undo can be reached).
  useEffect(() => {
    if (!current || leaving) return;
    const duration = current.options.duration ?? DEFAULT_DURATION_MS;
    if (!Number.isFinite(duration)) return;
    let timer = 0;
    const expire = () => {
      if (toastRef.current?.contains(document.activeElement)) {
        timer = window.setTimeout(expire, FOCUS_RECHECK_MS);
      } else {
        dispatch({ type: 'hide', id: current.id });
      }
    };
    timer = window.setTimeout(expire, duration);
    return () => window.clearTimeout(timer);
  }, [current, leaving]);

  // On its way out: keep it (ignoring taps) for a moment, then show the next one.
  useEffect(() => {
    if (!current || !leaving) return;
    const timer = window.setTimeout(
      () => dispatch({ type: 'remove', id: current.id }),
      TOAST_EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [current, leaving]);

  // One live region for the app's lifetime, moved to wherever toasts must show.
  const [region] = useState(() => document.createElement('div'));
  const pageSlot = useRef<HTMLDivElement>(null);
  const sheetOutlet = useTopSheetOutlet();
  useLayoutEffect(() => {
    const parent = sheetOutlet ?? pageSlot.current;
    if (parent && region.parentNode !== parent) parent.appendChild(region);
  }, [region, sheetOutlet]);
  useEffect(() => () => region.remove(), [region]);

  const runAction = (toast: ActiveToast) => {
    if (leaving || actedOn.current === toast.id) return;
    actedOn.current = toast.id;
    dispatch({ type: 'hide', id: toast.id });
    toast.options.onAction?.();
  };

  const placement = current?.options.placement ?? 'bottom';

  const viewport = (
    <div
      role="status"
      aria-live="polite"
      aria-label="Notifications"
      className={cx(styles.viewport, sheetOutlet ? styles.overSheet : styles[placement])}
    >
      {current ? (
        <div
          // A new key replays the entrance, so a replacement toast is noticed (and announced).
          key={current.id}
          ref={toastRef}
          className={cx(
            styles.toast,
            current.options.actionLabel && styles.withAction,
            leaving && styles.leaving,
          )}
        >
          <p className={styles.message}>{current.options.message}</p>
          {current.options.actionLabel ? (
            <button
              type="button"
              className={styles.action}
              aria-disabled={leaving || undefined}
              onClick={() => runAction(current)}
            >
              {current.options.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <ToastContext value={toaster}>
      {children}
      <div ref={pageSlot} />
      {createPortal(viewport, region)}
    </ToastContext>
  );
}
