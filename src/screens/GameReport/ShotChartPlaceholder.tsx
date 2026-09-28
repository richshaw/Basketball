import { Card } from '@/components/Card/Card';
import { BasketballIcon } from '@/components/Icons/Icons';
import styles from './ShotChartPlaceholder.module.css';

/**
 * PLACEHOLDER: a later PR replaces this component with a ShotMap of the game's 2PT
 * and 3PT shots that have a location (StatEvent.location). Nothing else depends on it.
 */
export function ShotChartPlaceholder() {
  return (
    <Card className={styles.placeholder}>
      <BasketballIcon className={styles.icon} />
      <p className={styles.title}>Shot chart coming soon</p>
      <p className={styles.text}>A map of where each shot was taken from.</p>
    </Card>
  );
}
