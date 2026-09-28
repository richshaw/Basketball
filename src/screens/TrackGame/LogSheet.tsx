import { memo, useMemo } from 'react';
import { Badge } from '@/components/Badge/Badge';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { Sheet } from '@/components/Sheet/Sheet';
import { periodLabel } from '@/data/stats';
import type { PeriodFormat, StatEvent } from '@/data/types';
import { cx } from '@/lib/cx';
import { formatClockTime, statKind, statLabel } from './tracking';
import styles from './LogSheet.module.css';

export interface LogSheetProps {
  open: boolean;
  /** The game's events, oldest first (as useGameEvents returns them). */
  events: readonly StatEvent[];
  periodFormat: PeriodFormat;
  /** A row was tapped: offer to delete that stat. */
  onSelect: (event: StatEvent) => void;
  onClose: () => void;
}

function LogList({
  events,
  periodFormat,
  onSelect,
}: Pick<LogSheetProps, 'events' | 'periodFormat' | 'onSelect'>) {
  const newestFirst = useMemo(() => [...events].reverse(), [events]);

  if (newestFirst.length === 0) {
    return <p className={styles.empty}>No stats yet. Tap a button to record one.</p>;
  }

  return (
    <GroupedList aria-label="Stats, newest first">
      {newestFirst.map((event) => (
        <ListRow
          key={event.id}
          icon={<span className={cx(styles.dot, styles[statKind(event.type)])} />}
          title={statLabel(event.type)}
          value={
            <span className={styles.meta}>
              <Badge className={styles.period}>{periodLabel(event.period, periodFormat)}</Badge>
              <span>{formatClockTime(event.createdAt)}</span>
            </span>
          }
          onClick={() => onSelect(event)}
        />
      ))}
    </GroupedList>
  );
}

/**
 * Every stat recorded in this game, newest first, with its period and time. Tapping
 * one offers to delete it (for mistakes found later; Undo covers the last one).
 */
export const LogSheet = memo(function LogSheet({
  open,
  events,
  periodFormat,
  onSelect,
  onClose,
}: LogSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Stat log"
      description={events.length > 0 ? 'Newest first. Tap a stat to delete it.' : undefined}
    >
      {/* Only rendered while the sheet is showing: the Sheet renders nothing while closed. */}
      <LogList events={events} periodFormat={periodFormat} onSelect={onSelect} />
    </Sheet>
  );
});
