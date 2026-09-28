import type { ReactNode } from 'react';
import { Badge } from '@/components/Badge/Badge';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { StatTile, StatTileGrid } from '@/components/StatTile/StatTile';
import { percentage, type StatLine } from '@/data/stats';
import { formatMadeAttempted, formatPct } from '@/lib/format';
import styles from './BoxScore.module.css';

/** Personal fouls that foul a player out (high school rules). */
const FOUL_OUT_LIMIT = 5;

interface LineProps {
  line: StatLine;
}

/** '5/9 FG' under the points, or '3/4 FT' for a game of only free throws. */
function pointsDetail(line: StatLine): string | undefined {
  if (line.fga > 0) return `${formatMadeAttempted(line.fgm, line.fga)} FG`;
  if (line.fta > 0) return `${formatMadeAttempted(line.ftm, line.fta)} FT`;
  return undefined;
}

/** The headline numbers, biggest first: points, rebounds, assists, steals, blocks, turnovers. */
export function HeadlineStats({ line }: LineProps) {
  return (
    <StatTileGrid columns={3} aria-label="Game totals">
      <StatTile
        value={line.pts}
        label="PTS"
        fullLabel="Points"
        detail={pointsDetail(line)}
        highlight
      />
      <StatTile
        value={line.reb}
        label="REB"
        fullLabel="Rebounds"
        detail={line.reb > 0 ? `${line.oreb} off · ${line.dreb} def` : undefined}
      />
      <StatTile value={line.ast} label="AST" fullLabel="Assists" />
      <StatTile value={line.stl} label="STL" fullLabel="Steals" />
      <StatTile value={line.blk} label="BLK" fullLabel="Blocks" />
      <StatTile value={line.tov} label="TO" fullLabel="Turnovers" />
    </StatTileGrid>
  );
}

const SHOTS = [
  { label: 'FG', fullLabel: 'Field goal percentage', made: 'fgm', attempted: 'fga' },
  { label: '2PT', fullLabel: 'Two-point percentage', made: 'fg2m', attempted: 'fg2a' },
  { label: '3PT', fullLabel: 'Three-point percentage', made: 'fg3m', attempted: 'fg3a' },
  { label: 'FT', fullLabel: 'Free throw percentage', made: 'ftm', attempted: 'fta' },
] as const satisfies readonly {
  label: string;
  fullLabel: string;
  made: keyof StatLine;
  attempted: keyof StatLine;
}[];

/** A percentage with a smaller % sign (so '100%' fits a tile), or '–' without attempts. */
function Percent({ value }: { value: number | null }) {
  const text = formatPct(value);
  if (!text.endsWith('%')) return text;
  return (
    <>
      {text.slice(0, -1)}
      <span className={styles.percentSign}>%</span>
    </>
  );
}

/** '5/9' on screen, "5 of 9 made" for screen readers. */
function MadeOfAttempted({ made, attempted }: { made: number; attempted: number }) {
  return (
    <>
      <span aria-hidden="true">{formatMadeAttempted(made, attempted)}</span>
      <span className="visually-hidden">
        {made} of {attempted} made
      </span>
    </>
  );
}

/** Percentage and makes/attempts for field goals, twos, threes and free throws. */
export function ShootingStats({ line }: LineProps) {
  return (
    <StatTileGrid aria-label="Shooting percentages">
      {SHOTS.map((shot) => {
        const made = line[shot.made];
        const attempted = line[shot.attempted];
        return (
          <StatTile
            key={shot.label}
            value={<Percent value={percentage(made, attempted)} />}
            label={shot.label}
            fullLabel={shot.fullLabel}
            detail={<MadeOfAttempted made={made} attempted={attempted} />}
          />
        );
      })}
    </StatTileGrid>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className={styles.count}>{children}</span>;
}

/** The effort stats and the ones nobody brags about, with a clear flag at five fouls. */
export function HustleStats({ line }: LineProps) {
  const fouledOut = line.pf >= FOUL_OUT_LIMIT;
  return (
    <GroupedList aria-label="Hustle and more">
      <ListRow title="Deflections" value={<Count>{line.deflections}</Count>} />
      <ListRow title="Charges taken" value={<Count>{line.charges}</Count>} />
      <ListRow
        title="Fouls"
        value={
          fouledOut ? (
            <span className={styles.fouls}>
              <Badge tone="miss">Fouled out</Badge>
              <Count>{line.pf}</Count>
            </span>
          ) : (
            <Count>{line.pf}</Count>
          )
        }
      />
    </GroupedList>
  );
}
