import { useLayoutEffect, type ReactNode } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog/ConfirmProvider';
import { listenForTaps } from '@/components/Sheet/secondTap';
import { ToastProvider } from '@/components/Toast/ToastProvider';

/**
 * App-wide UI: toasts (`useToast`) and confirmations (`useConfirm`). App mounts it
 * once at the root, and the test render helpers wrap every render in it. It also notes
 * every tap from the start (secondTap.ts), so a screen's very first sheet or dialog
 * already catches a double tap's second tap: "Delete this stat?" on a game report
 * opened from Games, say, which no sheet came before.
 */
export function UiProviders({ children }: { children: ReactNode }) {
  useLayoutEffect(listenForTaps, []);
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
