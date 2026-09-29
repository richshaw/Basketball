import type { CloudBackupStatus } from '@/data/backup/cloudBackup';

/** Why the banner shows: backup `paused` for the parent's decision, or `stopped` by a problem. */
export type BackupBannerReason = 'paused' | 'stopped';

/**
 * When cloud backup needs the parent: paused to keep the online backup safe (games
 * missing here, or another phone backing up with the code), or stopped by a problem
 * retrying can't fix. Waiting for signal or retrying later doesn't need her.
 */
export function backupBannerReason(
  status: CloudBackupStatus | undefined,
): BackupBannerReason | null {
  if (!status?.enabled) return null;
  switch (status.state) {
    case 'paused-shrink':
    case 'paused-other-device':
      return 'paused';
    case 'needs-attention':
      return 'stopped';
    default:
      return null;
  }
}
