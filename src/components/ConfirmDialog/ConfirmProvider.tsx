import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfirmContext, type Confirm, type ConfirmOptions } from './confirmContext';

interface ConfirmRequest {
  id: number;
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

/**
 * Renders the ConfirmDialog behind `useConfirm()`, one question at a time. Mounted
 * once, at the app root.
 *
 * A question asked while a dialog is on screen (even one that is only animating
 * away) waits until that dialog has fully closed. It then opens from scratch, with
 * focus on its safe button, so a double tap that answered one question can never
 * answer the next.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // The request on screen. It stays while its dialog animates out, to keep its text.
  const [shown, setShown] = useState<{ request: ConfirmRequest; open: boolean } | null>(null);
  const unanswered = useRef<ConfirmRequest | null>(null);
  const waiting = useRef<ConfirmRequest | null>(null);
  // True from the moment a dialog has actually opened until it has finished closing.
  const dialogOnScreen = useRef(false);
  const lastId = useRef(0);

  useLayoutEffect(() => {
    if (shown?.open) dialogOnScreen.current = true;
  }, [shown]);

  const present = useCallback((request: ConfirmRequest) => {
    unanswered.current = request;
    setShown({ request, open: true });
  }, []);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        lastId.current += 1;
        const request = { id: lastId.current, options, resolve };
        // A newer question replaces any that's open or waiting, which counts as cancelled.
        unanswered.current?.resolve(false);
        unanswered.current = null;
        waiting.current?.resolve(false);
        waiting.current = null;

        if (dialogOnScreen.current) {
          waiting.current = request;
          setShown((current) => (current ? { ...current, open: false } : current));
        } else {
          present(request);
        }
      }),
    [present],
  );

  const answer = (confirmed: boolean) => {
    unanswered.current?.resolve(confirmed);
    unanswered.current = null;
    setShown((current) => (current ? { ...current, open: false } : current));
  };

  // The dialog has finished closing: show the question that was waiting, if any.
  const handleClosed = () => {
    dialogOnScreen.current = false;
    const next = waiting.current;
    waiting.current = null;
    if (next) present(next);
    else setShown(null);
  };

  // Never leave a caller waiting forever.
  useEffect(() => {
    const pending = { unanswered, waiting };
    return () => {
      pending.unanswered.current?.resolve(false);
      pending.waiting.current?.resolve(false);
    };
  }, []);

  return (
    <ConfirmContext value={confirm}>
      {children}
      {shown ? (
        <ConfirmDialog
          // A fresh dialog per question: it opens from scratch and focuses its safe button.
          key={shown.request.id}
          {...shown.request.options}
          open={shown.open}
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
          onClosed={handleClosed}
        />
      ) : null}
    </ConfirmContext>
  );
}
