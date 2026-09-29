import { Link } from 'react-router';
import { AlertIcon, ChevronRightIcon } from '@/components/Icons/Icons';
import { useCloudBackupStatus } from '@/data/backup/hooks';
import { paths } from '@/routes';
import { backupBannerReason, type BackupBannerReason } from './backupBannerReason';
import styles from './BackupBanner.module.css';

const MESSAGES: Record<BackupBannerReason, string> = {
  paused: 'Cloud backup is paused.',
  stopped: 'Cloud backup has stopped.',
};

/** The banner itself, always shown (the /dev/ui gallery uses it as is). */
export function BackupBannerView({ reason }: { reason: BackupBannerReason }) {
  return (
    <aside className={styles.banner} aria-label="Cloud backup">
      <Link to={paths.settingsSection('cloud-backup')} className={styles.link}>
        <AlertIcon className={styles.icon} />
        <span className={styles.message}>
          {MESSAGES[reason]} <span className={styles.fix}>Tap to fix</span>
        </span>
        <ChevronRightIcon className={styles.chevron} />
      </Link>
    </aside>
  );
}

/**
 * A one-line banner at the top of the tab screens while cloud backup needs the parent
 * (see backupBannerReason); it opens Settings at the Cloud backup section. Rendered
 * by AppShell only, so it never shows on the live game screen.
 */
export function BackupBanner() {
  const reason = backupBannerReason(useCloudBackupStatus());
  return reason ? <BackupBannerView reason={reason} /> : null;
}
