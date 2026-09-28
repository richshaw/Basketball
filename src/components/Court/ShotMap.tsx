import { useId, type ReactNode } from 'react';
import { countShots, hasLocation, type Shot } from '@/data/shots';
import { cx } from '@/lib/cx';
import { HalfCourt } from './HalfCourt';
import { describeShots, locationNote } from './shotLabels';
import { ShotGlyph, ShotMarkers } from './ShotMarkers';
import styles from './ShotMap.module.css';

export interface ShotMapProps {
  /**
   * The shots (see `shotsFromEvents`): a filled circle per make and an × per miss for
   * each one with a location; a note says how many of them have one.
   */
  shots: readonly Shot[];
  /** Shown above the court, e.g. "Shot chart". Also names the chart for screen readers. */
  title?: string;
  /** A line under the title, e.g. "Fall 2026 · 10 games". */
  caption?: ReactNode;
  className?: string;
}

/**
 * A shot chart: every shot with a location on a half court, with a legend of makes
 * and misses. Display only. Screen readers get the totals and each zone's shooting.
 */
export function ShotMap({ shots, title, caption, className }: ShotMapProps) {
  const captionId = useId();
  const located = shots.filter(hasLocation);
  const { made, attempted } = countShots(located);
  const name = title || 'Shot chart';
  const hasCaption = Boolean(title || caption);

  return (
    <figure
      className={cx(styles.shotMap, className)}
      aria-labelledby={hasCaption ? captionId : undefined}
    >
      {hasCaption ? (
        <figcaption id={captionId} className={styles.header}>
          {title ? <span className={styles.title}>{title}</span> : null}{' '}
          {caption ? <span className={styles.caption}>{caption}</span> : null}
        </figcaption>
      ) : null}
      <HalfCourt aria-label={`${name}: ${describeShots(shots)}`}>
        <ShotMarkers shots={located} />
      </HalfCourt>
      {/* Flex gaps space it out on screen; the spaces keep the words apart for screen readers. */}
      <p className={styles.legend}>
        <span className={styles.key}>
          <ShotGlyph made />
          Made <span className={styles.count}>{made}</span>
        </span>{' '}
        <span aria-hidden="true">·</span>{' '}
        <span className={styles.key}>
          <ShotGlyph made={false} />
          Missed <span className={styles.count}>{attempted - made}</span>
        </span>
      </p>
      {located.length < shots.length ? (
        <p className={styles.note}>{locationNote(located.length, shots.length)}</p>
      ) : null}
    </figure>
  );
}
