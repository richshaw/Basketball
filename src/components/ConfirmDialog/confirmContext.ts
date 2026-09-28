import { createContext, useContext } from 'react';
import type { ConfirmDialogProps } from './ConfirmDialog';

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'destructive'
>;

/** Shows a ConfirmDialog and resolves to true (confirmed) or false (cancelled). */
export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<Confirm | null>(null);

/**
 * Promise-style confirmation (needs the ConfirmProvider that App mounts):
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: 'Delete this game?', confirmLabel: 'Delete game', destructive: true })) { ... }
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm() needs a <ConfirmProvider> above it (see App.tsx).');
  return confirm;
}
