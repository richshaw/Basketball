import type { ReactNode } from 'react';
import { ConfirmProvider } from '@/components/ConfirmDialog/ConfirmProvider';
import { ToastProvider } from '@/components/Toast/ToastProvider';

/**
 * App-wide UI: toasts (`useToast`) and confirmations (`useConfirm`). App mounts it
 * once at the root, and the test render helpers wrap every render in it.
 */
export function UiProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>{children}</ConfirmProvider>
    </ToastProvider>
  );
}
