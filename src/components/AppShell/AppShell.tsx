import { Outlet } from 'react-router';
import { TabBar } from '@/components/TabBar/TabBar';
import { UpdateBanner } from '@/components/UpdateBanner/UpdateBanner';
import styles from './AppShell.module.css';

/**
 * Layout for the tab screens (Games, Stats, Settings): the page content, the
 * update banner and the bottom tab bar. Full-screen routes (new game, game
 * report, live tracking) render without it.
 */
export function AppShell() {
  return (
    <div className={styles.shell}>
      <div className={styles.content}>
        <Outlet />
      </div>
      <UpdateBanner />
      <TabBar />
    </div>
  );
}
