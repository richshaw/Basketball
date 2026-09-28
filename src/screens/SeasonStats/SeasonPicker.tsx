import { useState } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { ChevronRightIcon } from '@/components/Icons/Icons';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/SegmentedControl/SegmentedControl';
import { Sheet } from '@/components/Sheet/Sheet';
import { ALL_SEASONS, seasonKey, type SeasonKey } from './seasonFilter';
import styles from './SeasonPicker.module.css';

/** Longest label (characters) that still fits one segment, by number of segments. */
const SEGMENT_MAX_CHARS: Record<number, number> = { 2: 18, 3: 11 };

function fitsSegments(options: readonly SegmentedOption<SeasonKey>[]): boolean {
  const maxChars = SEGMENT_MAX_CHARS[options.length];
  return maxChars !== undefined && options.every((option) => option.label.length <= maxChars);
}

function CheckmarkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export interface SeasonPickerProps {
  /** Season labels, most recent first. */
  seasons: readonly string[];
  value: SeasonKey;
  onChange: (value: SeasonKey) => void;
}

/**
 * Picks which games the stats cover: all of them, or one season. A segmented
 * control while the choices fit on one line; otherwise a row that opens a sheet.
 */
export function SeasonPicker({ seasons, value, onChange }: SeasonPickerProps) {
  const [open, setOpen] = useState(false);
  const options: SegmentedOption<SeasonKey>[] = [
    { value: ALL_SEASONS, label: 'All' },
    ...seasons.map((season) => ({ value: seasonKey(season), label: season })),
  ];

  if (fitsSegments(options)) {
    return (
      <SegmentedControl aria-label="Season" options={options} value={value} onChange={onChange} />
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
