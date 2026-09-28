import { memo } from 'react';
import { Link } from 'react-router';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/Icons/Icons';
import { cx } from '@/lib/cx';
import { paths } from '@/routes';
import styles from './TopBar.module.css';

export interface TopBarProps {
  /** The screen title, e.g. 'vs Central'. */
  title: string;
  /** The current period, e.g. 'Q2' or 'OT'. */
  periodText: string;
  /** False at the last period a game can have. */
  canAdvance: boolean;
  onPickPeriod: () => void;
  onNextPeriod: () => void;
}

/**
 * The compact bar at the top of the live game screen: back to Games (leaving never
 * ends the game), the matchup, and the period control. Its props are all strings,
 * booleans and stable callbacks, so it doesn't re-render when a stat is recorded.
 */
export const TopBar = memo(function TopBar({
  title,
  periodText,
  canAdvance,
  onPickPeriod,
  onNextPeriod,
}: TopBarProps) {
  return (
    <header className={styles.bar}>
      <Link to={paths.home} className={styles.back}>
        <ChevronLeftIcon className={styles.backIcon} />
        <span>Games</span>
      </Link>
      <h1 className={styles.title}>{title}</h1>
      <div className={styles.period}>
        <button
          type="button"
          className={styles.periodButton}
          aria-label={`Period ${periodText}`}
          aria-haspopup="dialog"
          onClick={onPickPeriod}
        >
          <span className={cx(styles.pill, styles.current)}>
            <span className={styles.periodText}>{periodText}</span>
            <ChevronRightIcon className={cx(styles.icon, styles.pickIcon)} />
          </span>
        </button>
        <button
          type="button"
          className={styles.periodButton}
          aria-label="Next period"
          onClick={onNextPeriod}
          disabled={!canAdvance}
        >
          <span className={cx(styles.pill, styles.next)}>
            Next
            <ChevronRightIcon className={styles.icon} />
          </span>
        </button>
      </div>
    </header>
  );
});
