import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { isStandalone } from '@/components/InstallBanner/install';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useCloudBackupStatus } from '@/data/backup/hooks';
import { useGames, usePlayer, useSettings } from '@/data/hooks';
import type { SettingsSection } from '@/routes';
import { AboutSection } from './AboutSection';
import { BackupSection, type OnlineBackupNote } from './BackupSection';
import { backupCoverage, backupKeepsUp, type BackupCoverage } from './cloudBackupText';
import { CloudBackupSection } from './CloudBackupSection';
import { GameSetupSection } from './GameSetupSection';
import { InstallSection } from './InstallSection';
import { PlayerSection } from './PlayerSection';
import { StorageSection } from './StorageSection';
import { useBackupCode } from './useBackupCode';
import { useBackupSnapshot } from './useBackupSnapshot';
import styles from './SettingsScreen.module.css';

const CLOUD_BACKUP_SECTION: SettingsSection = 'cloud-backup';

/** What the backup files' note says about cloud backup (none: the stats are only here). */
function onlineBackupNote(coverage: BackupCoverage | undefined): OnlineBackupNote | undefined {
  if (!coverage || coverage.kind === 'none' || coverage.kind === 'off') return undefined;
  return backupKeepsUp(coverage) ? 'keeping-up' : 'behind';
}

/**
 * The player, game defaults, the encrypted cloud backup (in builds with a backup
 * server), backup files, storage, installing to the Home Screen, and the version,
 * sample data and erasing everything. iOS Settings style: grouped sections.
 * `?section=cloud-backup` (paths.settingsSection) opens it at the cloud backup.
 */
export function SettingsScreen() {
  const player = usePlayer();
  const settings = useSettings();
  const games = useGames();
  const cloudBackup = useCloudBackupStatus();
  const backupCode = useBackupCode();
  const { snapshot, fresh, currentSnapshot } = useBackupSnapshot();
  const [searchParams] = useSearchParams();
  // Only changes when the app is relaunched from the Home Screen.
  const [standalone] = useState(() => isStandalone());
  // Wait for the data, so nothing appears and then vanishes (e.g. "Try it with sample data").
  const loaded =
    player !== undefined &&
    settings !== undefined &&
    games !== undefined &&
    snapshot !== undefined &&
    cloudBackup !== undefined &&
    backupCode !== undefined;
  const coverage = loaded ? backupCoverage(cloudBackup, backupCode) : undefined;

  return (
    <main>
      <ScreenHeader title="Settings" />
      <ScreenBody>
        {loaded ? (
          <div className={styles.sections}>
            <PlayerSection player={player} />
            <GameSetupSection settings={settings} />
            {cloudBackup.available ? (
              <CloudBackupSection
                status={cloudBackup}
                code={backupCode}
                focusOnShow={searchParams.get('section') === CLOUD_BACKUP_SECTION}
              />
            ) : null}
            <BackupSection
              games={games}
              snapshot={snapshot}
              fresh={fresh}
              currentSnapshot={currentSnapshot}
              onlineBackup={onlineBackupNote(coverage)}
            />
            <StorageSection standalone={standalone} dataVersion={games} />
            {standalone ? null : <InstallSection />}
            <AboutSection player={player} games={games} cloudCoverage={coverage} />
          </div>
        ) : null}
      </ScreenBody>
    </main>
  );
}
