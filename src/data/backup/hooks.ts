/**
 * The cloud backup's status for screens. Re-renders when the stored state, the data
 * or an upload in this window changes. `undefined` while loading, like the data hooks.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useSyncExternalStore } from 'react';
import { getLastChangeAt } from '../repo';
import { getBackupRuntime, isCloudBackupAvailable, subscribeToBackupRuntime } from './cloudBackup';
import { loadBackupState } from './state';
import { deriveStatus, type CloudBackupStatus } from './status';

async function readStatusInputs() {
  const [stored, lastChangeAt] = await Promise.all([loadBackupState(), getLastChangeAt()]);
  return { stored, lastChangeAt };
}

/**
 * `{ available, enabled, state, lastSuccessAt, lastError, nextAttemptAt, pendingChanges,
 * shrink }`; see CloudBackupStatus in status.ts for what each state means.
 */
export function useCloudBackupStatus(): CloudBackupStatus | undefined {
  const runtime = useSyncExternalStore(subscribeToBackupRuntime, getBackupRuntime);
  const inputs = useLiveQuery(readStatusInputs);
  return useMemo(
    () =>
      inputs &&
      deriveStatus({
        available: isCloudBackupAvailable(),
        stored: inputs.stored,
        lastChangeAt: inputs.lastChangeAt,
        runtime,
      }),
    [inputs, runtime],
  );
}
