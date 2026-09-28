import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { ConfirmContext, type Confirm, type ConfirmOptions } from './confirmContext';

interface ConfirmRequest {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

/** Renders the one ConfirmDialog behind `useConfirm()`. Mounted once, at the app root. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  // The last request stays in state so its dialog keeps its text while it animates out.
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [open, setOpen] = useState(false);
  const unanswered = useRef<ConfirmRequest | null>(null);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        // A new question replaces one that's still open, which counts as cancelled.
        unanswered.current?.resolve(false);
        const next = { options, resolve };
        unanswered.current = next;
        setRequest(next);
        setOpen(true);
      }),
    [],
  );

  const answer = (confirmed: boolean) => {
    unanswered.current?.resolve(confirmed);
    unanswered.current = null;
    setOpen(false);
  };

  // Never leave a caller waiting forever.
  useEffect(() => {
    const pending = unanswered;
    return () => pending.current?.resolve(false);
  }, []);

  return (
    <ConfirmContext value={confirm}>
      {children}
      {request ? (
        <ConfirmDialog
          {...request.options}
          open={open}
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
      ) : null}
    </ConfirmContext>
  );
}
