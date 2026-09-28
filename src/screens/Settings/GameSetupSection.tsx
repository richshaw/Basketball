import { useId } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/SegmentedControl/SegmentedControl';
import { useToast } from '@/components/Toast/toastContext';
import { updateSettings, type SettingsPatch } from '@/data/repo';
import type { PeriodFormat, Settings } from '@/data/types';
import { Switch } from './Switch';
import styles from './GameSetupSection.module.css';

const PERIOD_OPTIONS: readonly SegmentedOption<PeriodFormat>[] = [
  { value: 'quarters', label: 'Quarters' },
  { value: 'halves', label: 'Halves' },
];

/** Defaults for new games, and whether the game screen asks where shots were taken. */
export function GameSetupSection({ settings }: { settings: Settings }) {
  const toast = useToast();
  const periodsLabelId = useId();
  const shotChartLabelId = useId();
  const shotChartHintId = useId();

  // Saved straight away; the controls follow the stored settings.
  const save = (patch: SettingsPatch) => {
    updateSettings(patch).catch((error: unknown) => {
      console.error('Saving settings failed', error);
      toast.show({ message: "Couldn't save that change. Try again." });
    });
  };

  return (
    <div>
      <GroupedList
        header="Game setup"
        footer="New games start with these periods. You can still change them when you start a game."
      >
        <ListRow
          title={<span id={shotChartLabelId}>Shot chart</span>}
          subtitle={
            <span id={shotChartHintId}>Tap the court to mark where each shot was taken</span>
          }
          value={
            <Switch
              aria-labelledby={shotChartLabelId}
              aria-describedby={shotChartHintId}
              checked={settings.shotChart}
              onChange={(shotChart) => save({ shotChart })}
            />
          }
        />
        <ListRow
          title={
            <span className={styles.periods}>
              <span id={periodsLabelId}>Periods</span>
              <SegmentedControl
                className={styles.periodControl}
                aria-labelledby={periodsLabelId}
                options={PERIOD_OPTIONS}
                value={settings.defaultPeriodFormat}
                onChange={(defaultPeriodFormat) => save({ defaultPeriodFormat })}
              />
            </span>
          }
        />
      </GroupedList>
    </div>
  );
}
