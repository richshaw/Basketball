import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import type { NotSaved } from './session';
import { notSavedTitle, unsavedNote } from './tracking';

export interface NotSavedSheetProps {
  open: boolean;
  /** The stats that weren't saved when Done was tapped. */
  notSaved: NotSaved | null;
  /** Saving (or leaving) right now: its buttons are off meanwhile. */
  busy: boolean;
  onTryAgain: () => void;
  /** Leave anyway: kept stats are saved later on their own. */
  onDoneAnyway: () => void;
  /** Stay on the live game screen. */
  onClose: () => void;
}

/**
 * Done, on a finished game being corrected, with stats that couldn't be saved: says
 * so plainly instead of leaving, and offers to try again or to leave anyway.
 */
export function NotSavedSheet({
  open,
  notSaved,
  busy,
  onTryAgain,
  onDoneAnyway,
  onClose,
}: NotSavedSheetProps) {
  const count = notSaved?.count ?? 0;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={notSavedTitle(count)}
      description={unsavedNote(count, notSaved?.kept ?? true)}
      footer={
        <>
          <Button size="lg" disabled={busy} onClick={onTryAgain}>
            Try again
          </Button>
          <Button variant="secondary" size="lg" disabled={busy} onClick={onDoneAnyway}>
            Done anyway
          </Button>
        </>
      }
    />
  );
}
