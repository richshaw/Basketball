import { useState } from 'react';
import { isStandalone } from '@/components/InstallBanner/install';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useGames, usePlayer, useSettings } from '@/data/hooks';
import { AboutSection } from './AboutSection';
import { BackupSection } from './BackupSection';
import { GameSetupSection } from './GameSetupSection';
import { InstallSection } from './InstallSection';
import { PlayerSection } from './PlayerSection';
import { StorageSection } from './StorageSection';
import styles from './SettingsScreen.module.css';

/**
 * The player, game defaults, backups (files now; the encrypted cloud backup later),
 * storage, installing to the Home Screen, and the version, sample data and erasing
 * everything. iOS Settings style: grouped sections.
 */
export function SettingsScreen() {
  const player = usePlayer();
  const settings = useSettings();
  const games = useGames();
  // Only changes when the app is relaunched from the Home Screen.
  const [standalone] = useState(() => isStandalone());
  // Wait for the data, so nothing appears and then vanishes (e.g. "Try it with sample data").
  const loaded = player !== undefined && settings !== undefined && games !== undefined;

  return (
    <main>
      <ScreenHeader title="Settings" />
      <ScreenBody>
        {loaded ? (
          <div className={styles.sections}>
            <PlayerSection player={player} />
            <GameSetupSection settings={settings} />
            {/* The automatic, encrypted cloud backup (a later PR) goes here, in its own group above the backup file rows. */}
            <BackupSection games={games} />
            <StorageSection standalone={standalone} dataVersion={games} />
            {standalone ? null : <InstallSection />}
            <AboutSection player={player} games={games} />
          </div>
        ) : null}
      </ScreenBody>
    </main>
  );
}
