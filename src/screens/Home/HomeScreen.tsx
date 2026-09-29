import { useEffect, useMemo, useRef, type Ref } from 'react';
import { ButtonLink } from '@/components/Button/ButtonLink';
import type { ButtonVariant } from '@/components/Button/buttonClassName';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { PlusIcon } from '@/components/Icons/Icons';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useAllEvents, useGameEvents, useGames, useLiveGame, usePlayer } from '@/data/hooks';
import { computeStatLine, statLinesForGames } from '@/data/stats';
import type { Player } from '@/data/types';
import { cx } from '@/lib/cx';
import { formatPlayerName, todayLocalISO } from '@/lib/format';
import { paths } from '@/routes';
import { FirstRunLinks } from './FirstRunLinks';
import { GameList } from './GameList';
import { LiveGameCard } from './LiveGameCard';
import { PlayerSetupCard } from './PlayerSetupCard';
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
 * button (with a quiet offer of sample data while there are no games) and every game
 * so far, newest first.
 */
export function HomeScreen() {
  const player = usePlayer();
  const games = useGames();
  const liveGame = useLiveGame();
  // Just the live game's events: the Resume card mustn't wait for every event there is.
  const liveEvents = useGameEvents(liveGame?.id);
  // Every event, only for the list's stat lines, which render last.
  const allEvents = useAllEvents();
  const newGameRef = useRef<HTMLAnchorElement>(null);
  const resumeRef = useRef<HTMLAnchorElement>(null);
  const wasSettingUp = useRef(false);

  const liveLine = useMemo(
    () => (liveGame && liveEvents ? computeStatLine(liveEvents) : undefined),
    [liveGame, liveEvents],
  );
  // One pass over every event for all the rows; redone only when the data changes.
  const entries = useMemo(
    () => (games && allEvents ? statLinesForGames(games, allEvents) : undefined),
    [games, allEvents],
  );

  // Everything above the list comes from small reads, so it shows at once. The list
  // comes in below it when every event is read, and nothing above it moves.
  const loading =
    player === undefined ||
    games === undefined ||
    liveGame === undefined ||
    (liveGame !== null && liveLine === undefined);
  const named = Boolean(player?.name.trim());
  const needsSetup = !loading && !named;
  const noGames = !loading && games.length === 0;
  const hasGames = !loading && games.length > 0;
  const today = todayLocalISO();

  // When the setup card goes away it takes focus with it: carry on at the next step,
  // the live game if there is one.
  useEffect(() => {
    if (needsSetup) {
      wasSettingUp.current = true;
      return;
    }
    if (!wasSettingUp.current) return;
    wasSettingUp.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      (resumeRef.current ?? newGameRef.current)?.focus();
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
          <LiveGameCard game={liveGame} line={liveLine} today={today} resumeRef={resumeRef} />
        ) : null}
        {needsSetup ? (
          <PlayerSetupCard
            player={player ?? null}
            // Resuming the live game stays the one main action.
            saveVariant={liveGame ? 'secondary' : 'primary'}
          />
        ) : null}

        {!needsSetup && noGames ? (
          <EmptyState
            icon="🏀"
            title="No games yet"
            message="Start one at tip-off, then tap a big button for each shot, rebound or assist. Every game you track shows up here."
            action={
              <div className={styles.emptyActions}>
                <NewGameButton ref={newGameRef} variant="primary" />
                <FirstRunLinks sampleData />
              </div>
            }
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
            {/* Under New game: on a small phone, Save and New game come first on screen. */}
            <FirstRunLinks restore={needsSetup} sampleData={noGames} />
          </div>
        )}

        {hasGames ? (
          // Busy until every event is read and the stat lines are in.
          <div aria-busy={entries ? undefined : true}>
            {entries ? <GameList entries={entries} today={today} /> : null}
          </div>
        ) : null}
      </ScreenBody>
    </main>
  );
}
