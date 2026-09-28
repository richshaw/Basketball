import { memo } from 'react';
import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import { periodLabel } from '@/data/stats';
import type { PeriodFormat } from '@/data/types';
import { periodChoices } from './tracking';
import styles from './PeriodSheet.module.css';

export interface PeriodSheetProps {
  open: boolean;
  /** The game's current period (1-based). */
  current: number;
  periodFormat: PeriodFormat;
  onPick: (period: number) => void;
  onClose: () => void;
}

/** Jump to any period: regulation, then overtimes. The current one is highlighted. */
export const PeriodSheet = memo(function PeriodSheet({
  open,
  current,
  periodFormat,
  onPick,
  onClose,
}: PeriodSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Period"
      description="New stats go into the period you pick."
    >
      <div className={styles.choices}>
        {periodChoices(current, periodFormat).map((period) => {
          const isCurrent = period === current;
          return (
            <Button
              key={period}
              variant={isCurrent ? 'primary' : 'secondary'}
              size="lg"
              className={styles.choice}
              aria-current={isCurrent ? 'true' : undefined}
              onClick={() => onPick(period)}
            >
              {periodLabel(period, periodFormat)}
            </Button>
          );
        })}
      </div>
    </Sheet>
  );
});
