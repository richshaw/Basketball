import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { CloseIcon } from '@/components/Icons/Icons';
import { cx } from '@/lib/cx';
import { registerOpenSheet } from './sheetStack';
import { useViewportInsets } from './useViewportInsets';
import styles from './Sheet.module.css';

export interface SheetProps {
  /** Shows the sheet while true (controlled). */
  open: boolean;
  /**
   * The user asked to close: the close button, a tap on the dimmed page, or Escape.
   * Set `open` to false in response.
   */
  onClose: () => void;
  /**
   * Called once the sheet has finished closing (after its exit animation), e.g. to
   * open the next sheet only when this one is gone.
   */
  onClosed?: () => void;
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
  /**
   * Element to focus when the sheet opens. By default focus starts on the close
   * button, or on the title when there is none; never on a text field, which would
   * open the iPhone keyboard.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Use `alertdialog` for a confirmation that interrupts (ConfirmDialog does). */
  role?: 'dialog' | 'alertdialog';
  /** Class name for the sheet panel. */
  className?: string;
}

/**
 * `closing`: the dialog has already closed (focus is back and the page works again)
 * but stays on screen, swallowing taps, while its exit animation plays.
 */
type Phase = 'closed' | 'open' | 'closing';

/** Finishes closing even if an exit animation never reports that it ended. */
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
 * with reduced motion), pads the home-indicator area, rides above the on-screen
 * keyboard, and locks page scrolling while open. Closing returns focus to whatever
 * opened it.
 */
export function Sheet({
  open,
  onClose,
  onClosed,
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
  const insets = useViewportInsets(phase === 'open');
  const notifyClosed = useEffectEvent(() => onClosed?.());

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

  // While open: lock page scrolling and let toasts show inside the sheet.
  useLayoutEffect(() => {
    const toastOutlet = toastOutletRef.current;
    if (phase !== 'open' || !toastOutlet) return;
    return registerOpenSheet(toastOutlet);
  }, [phase]);

  // Closing: close the dialog right away, so focus returns and the page (and any toast
  // shown now) works again, then keep it on screen until the exit animation ends.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (phase !== 'closing' || !dialog) return;

    if (dialog.open) dialog.close();
    const returnFocusTo = returnFocusRef.current;
    returnFocusRef.current = null;
    const focused = document.activeElement;
    const focusWasLost = !focused || focused === document.body || dialog.contains(focused);
    if (returnFocusTo?.isConnected && focusWasLost) returnFocusTo.focus({ preventScroll: true });

    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      setPhase('closed');
      notifyClosed();
    };
    const animations = runningAnimations(dialog, panelRef.current);
    Promise.all(animations.map((animation) => animation.finished)).then(finish, finish);
    const timeout = window.setTimeout(finish, EXIT_TIMEOUT_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [phase]);

  // When the keyboard moves the sheet, keep the focused field in view.
  useEffect(() => {
    if (insets.bottom === 0) return;
    const focused = document.activeElement;
    if (
      focused instanceof HTMLElement &&
      panelRef.current?.contains(focused) &&
      typeof focused.scrollIntoView === 'function'
    ) {
      focused.scrollIntoView({ block: 'nearest' });
    }
  }, [insets.top, insets.bottom]);

  if (phase === 'closed') return null;
  const closing = phase === 'closing';

  // `cancel` and `close` don't bubble in the DOM, but React passes them up to ancestor
  // handlers: ignore the ones that belong to a dialog nested inside this sheet.

  // Escape (or another close request): `open` decides, so never let the browser close it.
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (dismissible && phase === 'open') onClose();
  };

  // The browser closed the dialog by itself, e.g. after Escape twice in a row. ("close"
  // arrives from a queued task, so ignore one that finds the dialog open again.)
  const handleClose = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget || event.currentTarget.open || phase !== 'open') {
      return;
    }
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

  // Lifts the panel above the on-screen keyboard (see useViewportInsets).
  const keyboardInsets = {
    '--keyboard-inset': `${insets.bottom}px`,
    '--viewport-inset-top': `${insets.top}px`,
  } as CSSProperties;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      style={keyboardInsets}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-closing={closing ? '' : undefined}
      onCancel={handleCancel}
      onClose={handleClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      <div ref={panelRef} className={cx(styles.panel, className)}>
        {/* The content goes inert while closing, so a second tap can't fire an action twice. */}
        <div className={styles.header} inert={closing}>
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
        {/* Toasts shown while this sheet is on top appear here, under the header. */}
        <div ref={toastOutletRef} className={styles.toastOutlet} />
        {children === undefined || children === null ? null : (
          <div className={styles.body} inert={closing}>
            {children}
          </div>
        )}
        {footer ? (
          <div className={styles.footer} inert={closing}>
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
