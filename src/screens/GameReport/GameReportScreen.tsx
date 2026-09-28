import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/Button/Button';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { Card } from '@/components/Card/Card';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useToast } from '@/components/Toast/toastContext';
import { useGame, useGameEvents, usePlayer } from '@/data/hooks';
import { deleteGame } from '@/data/repo';
import { computeStatLine } from '@/data/stats';
import type { Game, Player, StatEvent } from '@/data/types';
import { formatGameDate } from '@/lib/format';
import { shareText } from '@/lib/share';
import { paths } from '@/routes';
import { HeadlineStats, HustleStats, ShootingStats } from './BoxScore';
import { EditGameSheet } from './EditGameSheet';
import type { ScoreField } from './gameForm';
import { GameSummary } from './GameSummary';
import { PeriodTable } from './PeriodTable';
import { PlayByPlay } from './PlayByPlay';
import { buildGameRecap, matchupLabel, recapTitle } from './recap';
import { ReportSection } from './ReportSection';
import { ShotChartPlaceholder } from './ShotChartPlaceholder';
import styles from './GameReportScreen.module.css';

/** Title while the game loads, and when there's no such game. */
const FALLBACK_TITLE = 'Game report';

/**
 * One game's report: the result, her numbers (most important first), a split by
 * period, the play-by-play for corrections, and actions to share a recap, edit the
 * details, add stats or delete the game.
 */
export function GameReportScreen() {
  const { gameId } = useParams();
  const game = useGame(gameId);
  const events = useGameEvents(gameId);
  const player = usePlayer();
  // While the game is being deleted, the report stays on screen as it was until
  // Games replaces it, instead of flashing "loading" or "not found" on its way out.
  const [leaving, setLeaving] = useState<ReportData | null>(null);

  if (leaving) return <GameReport {...leaving} onLeaving={setLeaving} />;

  if (game === null) {
    return (
      <main>
        <ScreenHeader title={FALLBACK_TITLE} backTo={paths.home} backLabel="Games" />
        <ScreenBody>
          <EmptyState
            icon="🔍"
            title="Game not found"
            message="It may have been deleted."
            action={
              <ButtonLink to={paths.home} variant="secondary">
                Go to Games
              </ButtonLink>
            }
          />
        </ScreenBody>
      </main>
    );
  }

  if (!game || events === undefined || player === undefined) {
    // Loading: IndexedDB answers in a few milliseconds, so show just the header.
    return (
      <main aria-busy="true">
        <ScreenHeader title={FALLBACK_TITLE} backTo={paths.home} backLabel="Games" />
      </main>
    );
  }

  return <GameReport game={game} events={events} player={player} onLeaving={setLeaving} />;
}

interface ReportData {
  game: Game;
  events: StatEvent[];
  player: Player | null;
}

interface GameReportProps extends ReportData {
  /** Called with what's on screen just before the game is deleted (null if that fails). */
  onLeaving: (leaving: ReportData | null) => void;
}

interface EditorState {
  open: boolean;
  /** Bumped on each opening, so the sheet starts from the game's current details. */
  session: number;
  /** The score field to start on ("Add score"), if any. */
  focusScore?: ScoreField;
}

function statsCount(count: number): string {
  if (count === 0) return '';
  return count === 1 ? ' and its 1 stat' : ` and all ${count} of its stats`;
}

function GameReport({ game, events, player, onLeaving }: GameReportProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [editor, setEditor] = useState<EditorState>({ open: false, session: 0 });
  const line = computeStatLine(events);
  const live = game.status === 'live';
  const matchup = matchupLabel(game);

  const openEditor = (focusScore?: ScoreField) =>
    setEditor((current) => ({ open: true, session: current.session + 1, focusScore }));
  const closeEditor = () => setEditor((current) => ({ ...current, open: false }));

  const shareRecap = async () => {
    // Built before the await: browsers only allow sharing and copying right after a tap.
    const result = await shareText({
      title: recapTitle(player, game),
      text: buildGameRecap(player, game, line),
    });
    if (result === 'copied') toast.show({ message: 'Copied' });
    else if (result === 'failed') toast.show({ message: "Couldn't share the recap" });
  };

  const removeGame = async () => {
    const confirmed = await confirm({
      title: 'Delete this game?',
      message: `The game against ${game.opponent} on ${formatGameDate(game.date)}${statsCount(events.length)} will be gone for good.`,
      confirmLabel: 'Delete game',
      destructive: true,
    });
    if (!confirmed) return;
    onLeaving({ game, events, player });
    try {
      await deleteGame(game.id);
    } catch (error) {
      console.error('Deleting the game failed', error);
      onLeaving(null);
      toast.show({ message: "Couldn't delete the game. Try again." });
      return;
    }
    void navigate(paths.home, { replace: true });
    toast.show({ message: 'Game deleted' });
  };

  return (
    <main>
      <ScreenHeader
        title={matchup}
        backTo={paths.home}
        backLabel="Games"
        action={
          <Button variant="ghost" aria-label="Edit details" onClick={() => openEditor()}>
            Edit
          </Button>
        }
      />
      <ScreenBody className={styles.body}>
        <div className={styles.overview}>
          <GameSummary game={game} onAddScore={openEditor} />
          <HeadlineStats line={line} />
          <Button size="lg" block variant={live ? 'secondary' : 'primary'} onClick={shareRecap}>
            Share recap
          </Button>
        </div>

        <ReportSection title="Shooting">
          <ShootingStats line={line} />
        </ReportSection>

        <ReportSection title="Hustle & more">
          <HustleStats line={line} />
        </ReportSection>

        <ReportSection title={game.periodFormat === 'halves' ? 'By half' : 'By quarter'}>
          <PeriodTable game={game} events={events} />
        </ReportSection>

        {/* PLACEHOLDER: a later PR swaps ShotChartPlaceholder for the real shot map. */}
        <ReportSection title="Shot chart">
          <ShotChartPlaceholder />
        </ReportSection>

        {game.notes ? (
          <ReportSection title="Notes">
            <Card>
              <p className={styles.notes}>{game.notes}</p>
            </Card>
          </ReportSection>
        ) : null}

        <PlayByPlay game={game} events={events} />

        <GroupedList aria-label="Delete">
          <ListRow title="Delete game" destructive onClick={removeGame} />
        </GroupedList>
      </ScreenBody>

      {editor.session > 0 ? (
        <EditGameSheet
          key={editor.session}
          game={game}
          open={editor.open}
          onClose={closeEditor}
          focusScore={editor.focusScore}
        />
      ) : null}
    </main>
  );
}
