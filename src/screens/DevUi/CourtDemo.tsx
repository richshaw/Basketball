import { useState } from 'react';
import { Button } from '@/components/Button/Button';
import { CourtPicker } from '@/components/Court/CourtPicker';
import { shotValueLabel } from '@/components/Court/shotLabels';
import { ShotMap } from '@/components/Court/ShotMap';
import { ShotZoneSummary } from '@/components/Court/ShotZoneSummary';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/SegmentedControl/SegmentedControl';
import { buildDemoData, DEMO_SEASON, demoGameId } from '@/data/demo';
import { shotsFromEvents } from '@/data/shots';
import type { CourtPoint } from '@/data/types';
import { shotDistanceFt } from '@/lib/court';
import styles from './DevUiScreen.module.css';

/** The demo season's shots (ten games), and the latest game's on their own. */
function buildDemoShots() {
  const { games, events } = buildDemoData({ today: '2026-09-27' });
  const latestGame = demoGameId(games.length);
  return {
    games: games.length,
    season: shotsFromEvents(events),
    latestGame: shotsFromEvents(events.filter((event) => event.gameId === latestGame)),
  };
}

/** A spot on the right wing, beyond the arc. */
const FIRST_PICK: CourtPoint = { x: 16, y: 15.5 };

type Depth = 'crop' | 'full';
const depths: SegmentedOption<Depth>[] = [
  { value: 'crop', label: '30 ft' },
  { value: 'full', label: 'Half court' },
];

/** The Court section of the gallery: the shot chart components with demo data. */
export function CourtDemo() {
  const [shots] = useState(buildDemoShots);
  const [pending, setPending] = useState<CourtPoint | null>(FIRST_PICK);
  const [depth, setDepth] = useState<Depth>('crop');

  return (
    <>
      <ShotMap
        shots={shots.season}
        title="Season shot chart"
        caption={`${DEMO_SEASON} · ${shots.games} games`}
      />
      <ShotZoneSummary shots={shots.season} />

      <div className={styles.field}>
        <span className={styles.label}>Where was the shot?</span>
        <SegmentedControl
          aria-label="Court depth"
          options={depths}
          value={depth}
          onChange={setDepth}
        />
        <CourtPicker
          pending={pending}
          onPick={setPending}
          shots={shots.latestGame}
          depth={depth === 'crop' ? 30 : undefined}
        />
        <p className={styles.note} aria-live="polite">
          {pending
            ? `Picked: ${shotValueLabel(pending)} from ${Math.round(shotDistanceFt(pending))} ft`
            : 'Nothing picked'}
        </p>
      </div>
      <div className={styles.buttons}>
        <Button variant="secondary" onClick={() => setPending(null)}>
          Clear spot
        </Button>
      </div>
    </>
  );
}
