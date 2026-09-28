import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTopSheetOutlet } from '@/components/Sheet/sheetStack';
import { cx } from '@/lib/cx';
import { ToastContext, type Toaster, type ToastOptions } from './toastContext';
import styles from './Toast.module.css';

const DEFAULT_DURATION_MS = 4000;

interface ActiveToast extends ToastOptions {
  id: number;
}

/**
 * Owns the one toast on screen and gives `useToast()` to everything inside it.
 * Mounted once, at the app root. The toast floats above the bottom edge (and the
 * tab bar), never moves the layout, and only its action button takes taps.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  // The toast whose timer is on hold because it has keyboard focus.
  const [pausedId, setPausedId] = useState<number | null>(null);
  const lastId = useRef(0);

  const hide = useCallback((id?: number) => {
    setToast((current) => (current && (id === undefined || current.id === id) ? null : current));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    lastId.current += 1;
    const id = lastId.current;
    setToast({ ...options, id });
    return id;
  }, []);

  const toaster = useMemo<Toaster>(() => ({ show, hide }), [show, hide]);

  useEffect(() => {
    if (!toast || pausedId === toast.id) return;
    const duration = toast.duration ?? DEFAULT_DURATION_MS;
    if (!Number.isFinite(duration)) return;
    const timer = window.setTimeout(() => hide(toast.id), duration);
    return () => window.clearTimeout(timer);
  }, [toast, pausedId, hide]);

  // An open sheet makes the rest of the page inert, so show the toast inside it.
  const sheetOutlet = useTopSheetOutlet();

  const viewport = (
    // Always rendered, so screen readers are already watching it when a toast appears.
    <div
      role="status"
      aria-live="polite"
      aria-label="Notifications"
      className={cx(styles.viewport, sheetOutlet && styles.overSheet)}
    >
      {toast ? (
        <div
          // A new key replays the entrance, so a replacement toast is noticed (and announced).
          key={toast.id}
          className={cx(styles.toast, toast.actionLabel && styles.withAction)}
          onFocus={() => setPausedId(toast.id)}
          onBlur={() => setPausedId(null)}
        >
          <p className={styles.message}>{toast.message}</p>
          {toast.actionLabel ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                hide(toast.id);
                toast.onAction?.();
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <ToastContext value={toaster}>
      {children}
      {sheetOutlet ? createPortal(viewport, sheetOutlet) : viewport}
    </ToastContext>
  );
}
