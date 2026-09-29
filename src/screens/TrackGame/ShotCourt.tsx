import { memo, useEffect, useState } from 'react';
import { CourtPicker } from '@/components/Court/CourtPicker';
import { courtViewBox } from '@/components/Court/courtGeometry';
import type { Shot } from '@/data/shots';
import { statDefOf } from '@/data/stats';
import type { CourtPoint } from '@/data/types';
import { cx } from '@/lib/cx';
import type { SpotShot } from './session';
import { statLabel } from './tracking';
import styles from './ShotCourt.module.css';

/**
 * How far from the baseline the court goes, in feet: 3 feet past the top of the
 * three-point arc (25 feet out), so a three from the top of the key has room too.
 */
export const COURT_DEPTH = 28;

const view = courtViewBox(COURT_DEPTH);
/** The whole drawing's proportions: the court takes them unless the buttons need the height. */
const aspectRatio = `${view.width} / ${view.height}`;

/** How long "Tap 2PT or 3PT first" stays after a tap that had no shot to mark. */
export const COURT_HINT_MS = 1600;

export interface ShotCourtProps {
  /** This game's shots with a spot, drawn faintly (without the one being marked). */
  shots: readonly Shot[];
  /** The shot whose spot a tap on the court marks now, if any. */
  spotShot: SpotShot | null;
  /** A tap on the court. Keep it stable (useCallback), or the court re-renders. */
  onPick: (point: CourtPoint) => void;
  /** Bump it when a tap had no shot to mark: the court says how it works, briefly. */
  hintKey: number;
}

/**
 * The shot chart on the live game screen: a half court above the stat buttons. After
 * a 2PT or 3PT tap it's outlined, and a tap on it marks where that shot was taken
 * (another tap moves the spot), labeled with the shot's value: the button's, wherever
 * the spot is (the last-action line notes a spot across the arc). The shot was saved at
 * its button's tap, so the court is never needed (VoiceOver gets an image it can skip).
 *
 * It's the whole width unless that would leave the buttons too short (see
 * TrackGameScreen.module.css): then it's shorter, and the drawing is narrower, centered
 * on the same floor. Its size is set by the screen alone, so nothing it shows ever
 * moves or resizes anything.
 */
export const ShotCourt = memo(function ShotCourt({
  shots,
  spotShot,
  onPick,
  hintKey,
}: ShotCourtProps) {
  // The hint shows from each bump until COURT_HINT_MS later.
  const [hiddenHint, setHiddenHint] = useState(hintKey);
  useEffect(() => {
    const timer = setTimeout(() => setHiddenHint(hintKey), COURT_HINT_MS);
    return () => clearTimeout(timer);
  }, [hintKey]);

  const label = spotShot
    ? `Shot spot of the ${statLabel(spotShot.tap.type)} (optional)`
    : 'Shot spot (optional): tap 2PT or 3PT first';
  // The picked spot is labeled with the shot's value as recorded (its button).
  const three = spotShot !== null && statDefOf(spotShot.tap.type)?.shot === 'fg3';

  return (
    <div className={cx(styles.court, spotShot && styles.open)} style={{ aspectRatio }}>
      <CourtPicker
        className={styles.picker}
        depth={COURT_DEPTH}
        touchAction="none"
        shots={shots}
        pending={spotShot?.spot ?? null}
        pendingPoints={three ? 3 : 2}
        onPick={onPick}
        aria-label={label}
      />
      {hintKey !== hiddenHint ? (
        <p key={hintKey} className={styles.hint} aria-hidden="true">
          Tap 2PT or 3PT first
        </p>
      ) : null}
    </div>
  );
});
