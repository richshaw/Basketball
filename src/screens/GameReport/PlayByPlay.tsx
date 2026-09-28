import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { useToast } from '@/components/Toast/toastContext';
import { deleteStat } from '@/data/repo';
import { STAT_DEFS } from '@/data/stats';
import type { Game, StatEvent } from '@/data/types';
import { cx } from '@/lib/cx';
import { formatClockTime, playByPlay, type PeriodPlays, type Play } from './playByPlay';
import styles from './PlayByPlay.module.css';

export interface PlayByPlayProps {
  game: Game;
  events: readonly StatEvent[];
}

const kindClass = { made: styles.made, miss: styles.miss, other: styles.other } as const;

/**
 * Every stat of the game in order, grouped by period, each with the time it was
 * recorded and her points so far. Tapping one offers to delete it, for corrections.
 */
export function PlayByPlay({ game, events }: PlayByPlayProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const groups = playByPlay(events, game.periodFormat);

  const offerToDelete = async (play: Play, group: PeriodPlays) => {
    const { label } = STAT_DEFS[play.event.type];
    const confirmed = await confirm({
      title: 'Delete this stat?',
      message: `${label} in ${group.label} at ${formatClockTime(play.event.createdAt)}. This can't be undone.`,
      confirmLabel: 'Delete stat',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await deleteStat(play.event.id);
      toast.show({ message: `Deleted ${label}` });
    } catch (error) {
      console.error('Deleting a stat failed', error);
      toast.show({ message: "Couldn't delete the stat. Try again." });
    }
  };

  if (groups.length === 0) {
    return <p className={styles.empty}>No stats recorded yet.</p>;
  }

  return (
    <div className={styles.periods}>
      {groups.map((group) => (
        <GroupedList key={group.period} header={group.name} headingLevel={3}>
          {group.plays.map((play) => {
            const def = STAT_DEFS[play.event.type];
            return (
              <ListRow
                key={play.event.id}
                onClick={() => offerToDelete(play, group)}
                title={
                  <span className={styles.play}>
                    <span className={styles.time}>{formatClockTime(play.event.createdAt)}</span>
                    <span className={cx(styles.dot, kindClass[def.kind])} aria-hidden="true" />
                    <span className={styles.label}>{def.label}</span>
                  </span>
                }
                value={
                  <span className={cx(styles.points, play.scored > 0 && styles.scored)}>
                    {play.points} {play.points === 1 ? 'pt' : 'pts'}
                  </span>
                }
              />
            );
          })}
        </GroupedList>
      ))}
    </div>
  );
}
