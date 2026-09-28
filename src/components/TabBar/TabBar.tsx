import { NavLink } from 'react-router';
import { BasketballIcon, ChartIcon, GearIcon } from '@/components/Icons/Icons';
import { cx } from '@/lib/cx';
import { paths } from '@/routes';
import styles from './TabBar.module.css';

const tabs = [
  { to: paths.home, label: 'Games', Icon: BasketballIcon },
  { to: paths.stats, label: 'Stats', Icon: ChartIcon },
  { to: paths.settings, label: 'Settings', Icon: GearIcon },
] as const;

/** Bottom navigation between the tab screens. The active tab gets aria-current="page". */
export function TabBar() {
  return (
    <nav className={styles.tabBar} aria-label="Main">
      {tabs.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          // Games (`/`) is only active on its own path, not on every route below it.
          end={to === paths.home}
          className={({ isActive }) => cx(styles.tab, isActive && styles.active)}
        >
          <Icon className={styles.icon} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
