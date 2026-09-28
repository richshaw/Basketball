import { useRef, type ReactNode } from 'react';
import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';

export interface ConfirmDialogProps {
  /** Shows the dialog while true (controlled). */
  open: boolean;
  /** The question, e.g. "Delete this game?" */
  title: string;
  /** What happens if they confirm, e.g. "Its stats will be gone for good." */
  message?: ReactNode;
  /** Name the action, e.g. "Delete game". Defaults to "OK". */
  confirmLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  /** Red confirm button, and focus starts on Cancel. For actions that can't be undone. */
  destructive?: boolean;
  /** Tapped the confirm button. Set `open` to false in response. */
  onConfirm: () => void;
  /** Tapped Cancel, tapped the dimmed page or pressed Escape. Set `open` to false in response. */
  onCancel: () => void;
}

/**
 * A small confirmation sheet (an alertdialog) with one confirm and one cancel
 * button. Prefer undo over confirming; save this for things that can't be undone.
 * For a one-off question, `useConfirm()` is usually simpler than rendering this.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      role="alertdialog"
      hideCloseButton
      // Start on the safe choice when the action is destructive.
      initialFocusRef={destructive ? cancelRef : confirmRef}
      footer={
        <>
          <Button
            ref={confirmRef}
            variant={destructive ? 'danger' : 'primary'}
            size="lg"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          <Button ref={cancelRef} variant="secondary" size="lg" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </>
      }
    />
  );
}
