import { useState } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { CheckmarkIcon, ChevronRightIcon } from '@/components/Icons/Icons';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/SegmentedControl/SegmentedControl';
import { Sheet } from '@/components/Sheet/Sheet';
import { ALL_SEASONS, fitsSegments, seasonKey, type SeasonKey } from './seasonFilter';
import styles from './SeasonPicker.module.css';

export interface SeasonPickerProps {
  /** Season labels, most recent first. */
  seasons: readonly string[];
  value: SeasonKey;
  onChange: (value: SeasonKey) => void;
}

/**
 * Picks which games the stats cover: all of them, or one season. A segmented
 * control while the choices fit on one line; otherwise a row that opens a sheet. They
 * fit by their length (fitsSegments), unless the screen turns out to be narrower
 * than that allows for (Display Zoom on an iPhone SE is 320 points wide): the control
 * measures its labels, and the sheet takes over rather than cutting them (while the
 * screen is open).
 */
export function SeasonPicker({ seasons, value, onChange }: SeasonPickerProps) {
  const [open, setOpen] = useState(false);
  // Labels that didn't fit this screen after all (SegmentedControl's onOverflow).
  const [overflowed, setOverflowed] = useState<string | null>(null);
  const options: SegmentedOption<SeasonKey>[] = [
    { value: ALL_SEASONS, label: 'All' },
    ...seasons.map((season) => ({ value: seasonKey(season), label: season })),
  ];
  const labels = options.map((option) => option.label);
  const labelsKey = labels.join('\n');

  if (fitsSegments(labels) && overflowed !== labelsKey) {
    return (
      <SegmentedControl
        aria-label="Season"
        options={options}
        value={value}
        onChange={onChange}
        fitLabels
        onOverflow={() => setOverflowed(labelsKey)}
      />
    );
  }

  const current = options.find((option) => option.value === value) ?? options[0];
  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span className={styles.triggerLabel}>Season</span>
        <span className={styles.triggerValue}>
          <span className={styles.triggerText}>{current?.label}</span>
          <ChevronRightIcon className={styles.triggerChevron} />
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Season">
        <GroupedList aria-label="Seasons">
          {options.map((option) => (
            <ListRow
              key={option.value}
              title={option.label}
              value={
                option.value === value ? (
                  <span className={styles.check}>
                    <CheckmarkIcon className={styles.checkIcon} />
                    <span className="visually-hidden">(selected)</span>
                  </span>
                ) : undefined
              }
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            />
          ))}
        </GroupedList>
      </Sheet>
    </>
  );
}
