import { useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronRightIcon } from '@/components/Icons/Icons';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useGames, useLiveGame, useSeasons, useSettings } from '@/data/hooks';
import type { Game } from '@/data/types';
import { gameTitle } from '@/lib/gameTitle';
import { paths } from '@/routes';
import { NewGameForm } from './NewGameForm';
import { pastOpponents } from './newGame';
import styles from './NewGameScreen.module.css';

/** Points back to the game already going. Starting another one is still allowed. */
function LiveGameNotice({ game }: { game: Game }) {
  return (
    <div role="note" className={styles.notice}>
      <span className={styles.noticeDot} aria-hidden="true" />
      <p className={styles.noticeText}>You have a game in progress {gameTitle(game)}</p>
      {/* Replace, like Start game does: going back from the game lands on Games. */}
      <Link to={paths.trackGame(game.id)} replace className={styles.noticeLink}>
        Resume it
        <ChevronRightIcon className={styles.noticeChevron} />
      </Link>
    </div>
  );
}

/** Full-screen form for a new game; Start game goes straight to live tracking. */
export function NewGameScreen() {
  const settings = useSettings();
  const liveGame = useLiveGame();
  const games = useGames();
  const seasons = useSeasons();
  const opponents = useMemo(() => pastOpponents(games ?? []), [games]);
  // The form starts from the settings; the notice and the form appear together.
  const ready = settings !== undefined && liveGame !== undefined;

  return (
    <main>
      <ScreenHeader title="New game" backTo={paths.home} backLabel="Games" />
      <ScreenBody className={styles.body} aria-busy={ready ? undefined : true}>
        {ready ? (
          <>
            {liveGame ? <LiveGameNotice game={liveGame} /> : null}
            <NewGameForm settings={settings} opponents={opponents} seasons={seasons ?? []} />
          </>
        ) : null}
      </ScreenBody>
    </main>
  );
}
