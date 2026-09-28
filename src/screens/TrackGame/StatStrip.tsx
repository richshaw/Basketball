import { memo } from 'react';
import type { StatLine } from '@/data/stats';
import { cx } from '@/lib/cx';
import { formatMadeAttempted } from '@/lib/format';
import { foulStatus } from './tracking';
import styles from './StatStrip.module.css';

const COUNTERS = [
  { key: 'reb', short: 'REB', full: 'Rebounds' },
  { key: 'ast', short: 'AST', full: 'Assists' },
  { key: 'stl', short: 'STL', full: 'Steals' },
  { key: 'blk', short: 'BLK', full: 'Blocks' },
  { key: 'tov', short: 'TO', full: 'Turnovers' },
] as const satisfies readonly { key: keyof StatLine; short: string; full: string }[];

const SHOOTING = [
  { made: 'fgm', attempted: 'fga', short: 'FG', full: 'Field goals' },
  { made: 'fg3m', attempted: 'fg3a', short: '3P', full: '3-pointers' },
  { made: 'ftm', attempted: 'fta', short: 'FT', full: 'Free throws' },
] as const satisfies readonly {
  made: keyof StatLine;
  attempted: keyof StatLine;
  short: string;
  full: string;
}[];

const FOUL_NOTES = { ok: '', trouble: ' (foul trouble)', out: ' (fouled out)' } as const;

interface ItemProps {
  value: string | number;
  label: string;
  /** What a screen reader says instead of the value and short label. */
  spoken: string;
  className?: string;
}

/** The visible number and short label are hidden from screen readers, which hear `spoken`. */
function Item({ value, label, spoken, className }: ItemProps) {
  return (
    <li className={cx(styles.item, className)}>
      <span className={cx(styles.value, 'tabular-nums')} aria-hidden="true">
        {value}
      </span>
      <span className={styles.label} aria-hidden="true">
        {label}
      </span>
      <span className="visually-hidden">{spoken}</span>
    </li>
  );
}

/**
 * The player's totals for this game, readable at arm's length: points big, then the
 * counting stats and shooting. Fouls turn orange at 4 and red at 5 (fouled out).
 */
export const StatStrip = memo(function StatStrip({ line }: { line: StatLine }) {
  const fouls = foulStatus(line.pf);

  return (
    <ul role="list" aria-label="Game stats" className={styles.strip}>
      <Item value={line.pts} label="PTS" spoken={`Points: ${line.pts}`} className={styles.points} />
      {COUNTERS.map(({ key, short, full }) => (
        <Item key={key} value={line[key]} label={short} spoken={`${full}: ${line[key]}`} />
      ))}
      <Item
        value={line.pf}
        label="PF"
        spoken={`Fouls: ${line.pf}${FOUL_NOTES[fouls]}`}
        className={fouls === 'ok' ? undefined : styles[fouls]}
      />
      {SHOOTING.map(({ made, attempted, short, full }) => (
        <Item
          key={short}
          value={formatMadeAttempted(line[made], line[attempted])}
          label={short}
          spoken={`${full}: ${line[made]} of ${line[attempted]}`}
          className={styles.shooting}
        />
      ))}
    </ul>
  );
});
