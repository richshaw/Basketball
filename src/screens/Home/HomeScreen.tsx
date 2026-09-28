import { useEffect, useMemo, useRef, type Ref } from 'react';
import { ButtonLink } from '@/components/Button/ButtonLink';
import type { ButtonVariant } from '@/components/Button/buttonClassName';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useAllEvents, useGames, useLiveGame, usePlayer } from '@/data/hooks';
import { computeStatLine, statLinesForGames } from '@/data/stats';
import type { Player } from '@/data/types';
import { cx } from '@/lib/cx';
import { formatPlayerName, todayLocalISO } from '@/lib/format';
import { paths } from '@/routes';
import { GameList } from './GameList';
import { LiveGameCard } from './LiveGameCard';
import { PlayerSetupCard } from './PlayerSetupCard';
import { PlusIcon } from './PlusIcon';
import styles from './HomeScreen.module.css';

/** "Ava · #12" (or just "Ava" with no number). */
function playerLabel(player: Player): string {
  const name = formatPlayerName(player);
  return player.jerseyNumber ? `${name} · #${player.jerseyNumber}` : name;
}

function NewGameButton({
  variant,
  block = false,
  ref,
}: {
  variant: ButtonVariant;
  block?: boolean;
  ref: Ref<HTMLAnchorElement>;
}) {
  return (
    <ButtonLink ref={ref} to={paths.newGame} size="lg" variant={variant} block={block}>
      <PlusIcon className={styles.plus} />
      New game
    </ButtonLink>
  );
}

/**
 * The Games tab: the live game (to resume it), a first-run setup card, the New game
 * button and every game so far, newest first.
 */
export function HomeScreen() {
  const player = usePlayer();
  const games = useGames();
  const liveGame = useLiveGame();
  const events = useAllEvents();
  const newGameRef = useRef<HTMLAnchorElement>(null);
  const wasSettingUp = useRef(false);

  // One pass over every event for all the rows; redone only when the data changes.
  const entries = useMemo(
    () => (games && events ? statLinesForGames(games, events) : undefined),
    [games, events],
  );
  const liveLine = useMemo(
    () =>
      liveGame && events
        ? computeStatLine(events.filter((event) => event.gameId === liveGame.id))
        : undefined,
    [liveGame, events],
  );

  const loading = player === undefined || entries === undefined || liveGame === undefined;
  const named = Boolean(player?.name.trim());
  const needsSetup = !loading && !named;
  const noGames = !loading && entries.length === 0;
  const today = todayLocalISO();

  // When the setup card goes away it takes focus with it: carry on at the next step.
  useEffect(() => {
    if (needsSetup) {
      wasSettingUp.current = true;
      return;
    }
    if (!wasSettingUp.current) return;
    wasSettingUp.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      newGameRef.current?.focus();
    }
  }, [needsSetup]);

  return (
    <main>
      <ScreenHeader
        title="Games"
        action={player && named ? <p className={styles.player}>{playerLabel(player)}</p> : null}
      />
      {/* Hidden (not removed) until the data is in, so nothing jumps around as it loads. */}
      <ScreenBody
        className={cx(styles.body, loading && styles.loading)}
        aria-busy={loading || undefined}
      >
        {liveGame && liveLine ? (
          <LiveGameCard game={liveGame} line={liveLine} today={today} />
        ) : null}
        {needsSetup ? <PlayerSetupCard player={player ?? null} /> : null}

        {!needsSetup && noGames ? (
          <EmptyState
            icon="🏀"
            title="No games yet"
            message="Start one at tip-off, then tap a big button for each shot, rebound or assist. Every game you track shows up here."
            action={<NewGameButton ref={newGameRef} variant="primary" />}
          />
        ) : (
          <div className={styles.newGame}>
            {needsSetup && !liveGame ? (
              <p className={styles.hurry}>In a hurry? You can add the name later.</p>
            ) : null}
            <NewGameButton
              ref={newGameRef}
              block
              // A live game's Resume (or the first-run Save) is the main action when there is one.
              variant={liveGame || needsSetup ? 'secondary' : 'primary'}
            />
          </div>
        )}

        {entries?.length ? <GameList entries={entries} today={today} /> : null}
      </ScreenBody>
    </main>
  );
}
