import { useLiveQuery } from 'dexie-react-hooks';
import { getBackupCode } from '@/data/backup/cloudBackup';

async function backupCodeOrNull(): Promise<string | null> {
  return (await getBackupCode()) ?? null;
}

/**
 * This phone's cloud backup code (while backup is on, or kept after turning it off),
 * null when it has none, and undefined while loading. Follows every change.
 */
export function useBackupCode(): string | null | undefined {
  return useLiveQuery(backupCodeOrNull);
}
