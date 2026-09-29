import { useId, useRef, useState } from 'react';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { ChevronRightIcon } from '@/components/Icons/Icons';
import { useToast } from '@/components/Toast/toastContext';
import { deleteStat } from '@/data/repo';
import type { Game, StatEvent } from '@/data/types';
import { cx } from '@/lib/cx';
import { formatClockTime } from '@/lib/format';
import { paths } from '@/routes';
import {
  countPlays,
  EXPAND_ALL_UP_TO,
  periodSummary,
  playByPlay,
  type PeriodPlays,
  type Play,
} from './playByPlay';
import { ReportSection } from './ReportSection';
import styles from './PlayByPlay.module.css';

export interface PlayByPlayProps {
  game: Game;
  events: readonly StatEvent[];
}

const kindClass = { made: styles.made, miss: styles.miss, other: styles.other } as const;

/** What a play's button is called: '6:05, 2PT Made, +2 points' or '6:07, Def Reb'. */
function playName({ event, def, scored }: Play): string {
  const name = `${formatClockTime(event.createdAt)}, ${def.label}`;
  if (scored === 0) return name;
  return `${name}, +${scored} ${scored === 1 ? 'point' : 'points'}`;
}

/**
 * The "Play-by-play" section: every stat of the game in order, in one collapsible
 * group per period (all open at first for a short game), each play with the time it
 * was recorded and the points it added. Tapping a play offers to delete it, for
 * corrections; "Add or fix stats" opens the tracking screen for anything else.
 */
export function PlayByPlay({ game, events }: PlayByPlayProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const groups = playByPlay(events, game.periodFormat);
  const [openAtFirst] = useState(() => countPlays(groups) <= EXPAND_ALL_UP_TO);
  // Periods the parent opened or closed; the others follow openAtFirst.
  const [toggled, setToggled] = useState<ReadonlyMap<number, boolean>>(() => new Map());
  const baseId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const playButtons = useRef(new Map<string, HTMLButtonElement>());
  const periodButtons = useRef(new Map<number, HTMLButtonElement>());

  const isOpen = (period: number) => toggled.get(period) ?? openAtFirst;
  const toggle = (period: number) =>
    setToggled((current) => new Map(current).set(period, !(current.get(period) ?? openAtFirst)));

  /**
   * Once a play is deleted its button goes away, so focus moves to the next play in
   * its period, else the previous one, else a neighboring period, else the heading.
   */
  const moveFocusFrom = (play: Play, group: PeriodPlays) => {
    const index = group.plays.indexOf(play);
    const period = groups.indexOf(group);
    const targets = [
      playButtons.current.get(group.plays[index + 1]?.event.id ?? ''),
      playButtons.current.get(group.plays[index - 1]?.event.id ?? ''),
      periodButtons.current.get(groups[period + 1]?.period ?? 0),
      periodButtons.current.get(groups[period - 1]?.period ?? 0),
      headingRef.current,
    ];
    targets.find((target) => target?.isConnected)?.focus();
  };

  const offerToDelete = async (play: Play, group: PeriodPlays) => {
    const { label } = play.def;
    const confirmed = await confirm({
      title: 'Delete this stat?',
      message: `${label} in ${group.label} at ${formatClockTime(play.event.createdAt)}. This can't be undone.`,
      confirmLabel: 'Delete stat',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const removed = await deleteStat(play.event.id);
      moveFocusFrom(play, group);
      toast.show({ message: removed ? `Deleted ${label}` : 'That stat was already deleted' });
    } catch (error) {
      console.error('Deleting a stat failed', error);
      toast.show({ message: "Couldn't delete the stat. Try again." });
    }
  };

  return (
    <ReportSection
      title="Play-by-play"
      note={groups.length > 0 ? 'Tap a play to delete it.' : undefined}
      headingRef={headingRef}
    >
      {game.status === 'live' ? null : (
        <ButtonLink to={paths.trackGame(game.id)} variant="secondary" block>
          Add or fix stats
        </ButtonLink>
      )}
      {groups.length === 0 ? (
        <p className={styles.empty}>No stats recorded yet.</p>
      ) : (
        <div className={styles.periods}>
          {groups.map((group) => {
            const open = isOpen(group.period);
            const panelId = `${baseId}-period-${group.period}`;
            return (
              <div key={group.period} className={styles.period}>
                <h3 className={styles.periodHeading}>
                  <button
                    ref={(button) => {
                      if (!button) return;
                      periodButtons.current.set(group.period, button);
                      return () => {
                        periodButtons.current.delete(group.period);
                      };
                    }}
                    type="button"
                    className={styles.toggle}
                    aria-label={`${group.name}, ${periodSummary(group)}`}
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => toggle(group.period)}
                  >
                    <span className={styles.toggleText}>
                      <span className={styles.periodName}>{group.name}</span>
                      <span className={styles.periodSummary}>{periodSummary(group)}</span>
                    </span>
                    <ChevronRightIcon className={cx(styles.chevron, open && styles.chevronOpen)} />
                  </button>
                </h3>
                <ul
                  id={panelId}
                  role="list"
                  aria-label={`${group.name} plays`}
                  className={styles.plays}
                  hidden={!open}
                >
                  {group.plays.map((play) => (
                    <li key={play.event.id} className={styles.playItem}>
                      <button
                        ref={(button) => {
                          if (!button) return;
                          playButtons.current.set(play.event.id, button);
                          return () => {
                            playButtons.current.delete(play.event.id);
                          };
                        }}
                        type="button"
                        className={styles.play}
                        aria-label={playName(play)}
                        onClick={() => offerToDelete(play, group)}
                      >
                        <span className={styles.time}>{formatClockTime(play.event.createdAt)}</span>
                        <span
                          className={cx(styles.dot, kindClass[play.def.kind])}
                          aria-hidden="true"
                        />
                        <span className={styles.label}>{play.def.label}</span>
                        {play.scored > 0 ? (
                          <span className={styles.scored}>+{play.scored}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </ReportSection>
  );
}
