import { StatTile, StatTileGrid } from '@/components/StatTile/StatTile';
import { SHOT_ZONES, shotsByZone, type Shot } from '@/data/shots';
import { percentage } from '@/data/stats';
import { formatMadeAttempted, formatPct } from '@/lib/format';
import { SHOT_ZONE_LABELS, SHOT_ZONE_NAMES } from './shotLabels';

export interface ShotZoneSummaryProps {
  /** The same shots as the ShotMap next to it (see `shotsFromEvents`). */
  shots: readonly Shot[];
  /** Names the tiles for screen readers. */
  'aria-label'?: string;
  className?: string;
}

/**
 * Shooting by zone, one tile each for the paint, mid-range and 3-pointers: the
 * percentage, with made/attempted under it. 3PT counts every 3PT attempt, so it
 * matches the box score; the paint and mid-range split the 2PT attempts that have a
 * location (the ShotMap says how many shots have one).
 */
export function ShotZoneSummary({
  shots,
  'aria-label': ariaLabel = 'Shooting by zone',
  className,
}: ShotZoneSummaryProps) {
  const zones = shotsByZone(shots);
  return (
    <StatTileGrid columns={3} aria-label={ariaLabel} className={className}>
      {SHOT_ZONES.map((zone) => {
        const { made, attempted } = zones[zone];
        return (
          <StatTile
            key={zone}
            value={formatPct(percentage(made, attempted))}
            label={SHOT_ZONE_LABELS[zone]}
            fullLabel={SHOT_ZONE_NAMES[zone]}
            detail={
              <>
                <span aria-hidden="true">{formatMadeAttempted(made, attempted)}</span>
                <span className="visually-hidden">
                  {made} of {attempted} made
                </span>
              </>
            }
          />
        );
      })}
    </StatTileGrid>
  );
}
