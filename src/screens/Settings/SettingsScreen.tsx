import { useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { isStandalone } from '@/components/InstallBanner/install';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useCloudBackupStatus } from '@/data/backup/hooks';
import { useGames, usePlayer, useSettings } from '@/data/hooks';
import type { SettingsSection } from '@/routes';
import { AboutSection } from './AboutSection';
import { backupFileIsCurrent, readLastBackupFile } from './backupFiles';
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

/**
 * What the backup files' note says about cloud backup: undefined when the stats are only
 * here (no online backup, or none since it was turned off, deleted or yet to be made),
 * `behind` when the latest ones are (paused or stopped).
 */
function onlineBackupNote(coverage: BackupCoverage | undefined): OnlineBackupNote | undefined {
  if (!coverage) return undefined;
  if (backupKeepsUp(coverage)) return 'keeping-up';
  return coverage.kind === 'behind' || coverage.kind === 'stopped' ? 'behind' : undefined;
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
  // The last backup file saved here (a per-phone reminder, see readLastBackupFile).
  const [lastSaved, setLastSaved] = useState(readLastBackupFile);
  const [searchParams] = useSearchParams();
  // Each visit to the section's link (a tap on the backup banner) is a new location.
  const { key: locationKey } = useLocation();
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
  // Only while the data read is the latest: a change just made may not be in the file.
  const currentBackupFile =
    fresh && backupFileIsCurrent(lastSaved, snapshot?.lastChangeAt) ? lastSaved : undefined;

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
                focusRequest={
                  searchParams.get('section') === CLOUD_BACKUP_SECTION ? locationKey : undefined
                }
              />
            ) : null}
            <BackupSection
              games={games}
              snapshot={snapshot}
              fresh={fresh}
              currentSnapshot={currentSnapshot}
              onlineBackup={onlineBackupNote(coverage)}
              lastSaved={lastSaved}
              onSaved={setLastSaved}
            />
            <StorageSection standalone={standalone} dataVersion={games} />
            {standalone ? null : <InstallSection />}
            <AboutSection
              player={player}
              games={games}
              cloudCoverage={coverage}
              currentBackupFile={currentBackupFile}
            />
          </div>
        ) : null}
      </ScreenBody>
    </main>
  );
}
