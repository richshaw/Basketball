import { Outlet } from 'react-router';
import { BackupBanner } from '@/components/BackupBanner/BackupBanner';
import { InstallBanner } from '@/components/InstallBanner/InstallBanner';
import { TabBar } from '@/components/TabBar/TabBar';
import { UpdateBanner } from '@/components/UpdateBanner/UpdateBanner';
import styles from './AppShell.module.css';

/**
 * Layout for the tab screens (Games, Stats, Settings): the "Add to Home Screen"
 * banner (iPhone Safari only), the cloud backup banner (while backup needs the
 * parent), the page content, the update banner and the bottom tab bar. Full-screen
 * routes (new game, game report, live tracking, restore) render without it, so none
 * of these banners can interrupt a live game.
 */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <InstallBanner />
      <BackupBanner />
      <div className={styles.content}>
        <Outlet />
      </div>
      <UpdateBanner />
      <TabBar />
    </div>
  );
}
