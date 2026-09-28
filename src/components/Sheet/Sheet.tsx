import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { CloseIcon } from '@/components/Icons/Icons';
import { cx } from '@/lib/cx';
import { registerOpenSheet } from './sheetStack';
import styles from './Sheet.module.css';

export interface SheetProps {
  /** Shows the sheet while true (controlled). */
  open: boolean;
  /**
   * The user asked to close: the close button, a tap on the dimmed page, or Escape.
   * Set `open` to false in response.
   */
  onClose: () => void;
  /** Heading at the top; also the dialog's accessible name. */
  title: string;
  /** Short text under the title; also the dialog's accessible description. */
  description?: ReactNode;
  /** The content. It scrolls when the sheet is taller than the screen. */
  children?: ReactNode;
  /** Actions pinned under the content, e.g. Buttons (stacked full width). */
  footer?: ReactNode;
  /**
   * `false` means the sheet closes only through its own buttons: taps on the dimmed
   * page and Escape are ignored and there's no close button. Use it for forms that
   * would lose what was typed.
   */
  dismissible?: boolean;
  /** Hides the close (X) button, e.g. when the footer already has a Cancel button. */
  hideCloseButton?: boolean;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Element to focus when the sheet opens. By default the first focusable element gets focus. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Use `alertdialog` for a confirmation that interrupts (ConfirmDialog does). */
  role?: 'dialog' | 'alertdialog';
  /** Class name for the sheet panel. */
  className?: string;
}

/** `closing` keeps the sheet on screen while the exit animation plays. */
type Phase = 'closed' | 'open' | 'closing';

/** Closes the sheet even if an exit animation never reports that it finished. */
const EXIT_TIMEOUT_MS = 600;

/** The finite animations currently running on these elements (e.g. the exit animation). */
function runningAnimations(...elements: Array<Element | null>): Animation[] {
  return elements
    .flatMap((element) =>
      element && typeof element.getAnimations === 'function' ? element.getAnimations() : [],
    )
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity);
}

/**
 * Bottom sheet built on the native <dialog> element: `showModal()` keeps focus
 * inside and makes the page behind inert. It slides up from the bottom (a fade
 * with reduced motion), pads the home-indicator area and locks page scrolling
 * while open. Closing returns focus to whatever opened it.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  dismissible = true,
  hideCloseButton = false,
  closeLabel = 'Close',
  initialFocusRef,
  role = 'dialog',
  className,
}: SheetProps) {
  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed');
  // Follow the `open` prop. Closing goes through `closing` so the exit animation can play.
  if (open ? phase !== 'open' : phase === 'open') {
    setPhase(open ? 'open' : 'closing');
  }
  // Bumped when the browser closes the dialog on its own, to show it again if still `open`.
  const [reopenRequests, setReopenRequests] = useState(0);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const toastOutletRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const showCloseButton = dismissible && !hideCloseButton;

  // Open: show as a modal. The browser moves focus inside and makes the page inert.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (phase !== 'open' || !dialog || dialog.open) return;
    if (!returnFocusRef.current && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }
    // Where focus starts: the requested element, else the close button (the browser
    // picks the first focusable element), else the title. Never a text field unless
    // asked for, because focusing one opens the iPhone keyboard over the sheet.
    const requested = initialFocusRef?.current ?? null;
    const title = !requested && !showCloseButton ? titleRef.current : null;
    requested?.setAttribute('autofocus', '');
    // For a moment the title is the first element Tab can reach, so the browser starts there.
    if (title) title.tabIndex = 0;
    dialog.showModal();
    requested?.removeAttribute('autofocus');
    if (title) title.tabIndex = -1;
    const start = requested ?? title;
    if (start && document.activeElement !== start) start.focus();
  }, [phase, reopenRequests, initialFocusRef, showCloseButton]);

  // While open: lock page scrolling and let toasts show above the sheet.
  useLayoutEffect(() => {
    const toastOutlet = toastOutletRef.current;
    if (phase !== 'open' || !toastOutlet) return;
    return registerOpenSheet(toastOutlet);
  }, [phase]);

  // Closing: wait for the exit animation, then close the dialog and restore focus.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (phase !== 'closing' || !dialog) return;

    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      dialog.close();
      const returnFocusTo = returnFocusRef.current;
      returnFocusRef.current = null;
      const focused = document.activeElement;
      const focusWasLost = !focused || focused === document.body || dialog.contains(focused);
      if (returnFocusTo?.isConnected && focusWasLost) returnFocusTo.focus({ preventScroll: true });
      setPhase('closed');
    };

    const animations = dialog.open ? runningAnimations(dialog, panelRef.current) : [];
    Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);
    const timeout = window.setTimeout(finish, EXIT_TIMEOUT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [phase]);

  if (phase === 'closed') return null;

  // Escape (or another close request): `open` decides, so never let the browser close it.
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (dismissible && phase === 'open') onClose();
  };

  // The browser closed the dialog by itself, e.g. after Escape twice in a row.
  const handleClose = () => {
    if (phase !== 'open') return;
    if (dismissible) onClose();
    setReopenRequests((count) => count + 1);
  };

  // The dialog fills the screen, so a press that starts and ends on it (not on the
  // panel) is a tap on the dimmed page.
  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressStartedOnBackdrop.current = event.target === event.currentTarget;
  };
  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    const tappedBackdrop = pressStartedOnBackdrop.current && event.target === event.currentTarget;
    pressStartedOnBackdrop.current = false;
    if (tappedBackdrop && dismissible && phase === 'open') onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-closing={phase === 'closing' ? '' : undefined}
      onCancel={handleCancel}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {/* Inert while closing, so a second tap on an action can't fire it twice. */}
      <div ref={panelRef} className={cx(styles.panel, className)} inert={phase === 'closing'}>
        <div className={styles.header}>
          <div className={styles.headings}>
            {/*
              Focusable (from script only) just when it's the starting point: with no close
              button. Otherwise Chrome would start on it instead of the close button.
            */}
            <h2
              ref={titleRef}
              id={titleId}
              className={styles.title}
              tabIndex={showCloseButton ? undefined : -1}
            >
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className={styles.description}>
                {description}
              </p>
            ) : null}
          </div>
          {showCloseButton ? (
            <button
              type="button"
              className={styles.closeButton}
              aria-label={closeLabel}
              onClick={onClose}
            >
              <span className={styles.closeCircle}>
                <CloseIcon className={styles.closeIcon} />
              </span>
            </button>
          ) : null}
        </div>
        {children === undefined || children === null ? null : (
          <div className={styles.body}>{children}</div>
        )}
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
      {/* Toasts shown while this sheet is on top render here (see ToastProvider). */}
      <div ref={toastOutletRef} />
    </dialog>
  );
}
