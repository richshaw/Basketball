import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/Button/Button';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useToast } from '@/components/Toast/toastContext';
import { useGame, useGameEvents } from '@/data/hooks';
import {
  deleteStat,
  endGame,
  recordStat,
  setCurrentPeriod,
  undoLastStat,
  type FinalScore,
} from '@/data/repo';
import { computeStatLine, periodLabel, STAT_DEFS } from '@/data/stats';
import {
  MAX_PERIOD,
  type Game,
  type PeriodFormat,
  type StatEvent,
  type StatType,
} from '@/data/types';
import { paths } from '@/routes';
import { EndGameSheet } from './EndGameSheet';
import { LastActionLine, type LastAction } from './LastActionLine';
import { LogSheet } from './LogSheet';
import { PeriodSheet } from './PeriodSheet';
import { StatGrid } from './StatGrid';
import { StatStrip } from './StatStrip';
import { TopBar } from './TopBar';
import { countByType, formatClockTime, matchupTitle, statLabel } from './tracking';
import { useWakeLock } from './useWakeLock';
import styles from './TrackGameScreen.module.css';

/** Puts a message on the last-action line. */
type ShowAction = (action: Omit<LastAction, 'key'>) => void;

/** Runs `run` the first time only, so a double tap on an inline Undo acts once. */
function once(run: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    run();
  };
}

/**
 * Removes one particular stat: the one an inline Undo belongs to (never "whatever is
 * latest"), so a repeated tap can't take away a second stat. Works even while the
 * stat is still being saved.
 */
function removeStat(show: ShowAction, saved: Promise<StatEvent>, label: string): void {
  show({ message: `Removed ${label}`, tone: 'muted' });
  saved.then(
    (event) =>
      deleteStat(event.id).then(undefined, () =>
        show({ message: `Couldn't remove ${label}`, tone: 'error' }),
      ),
    // Never saved: the save error is already on the line.
    () => undefined,
  );
}

/** Saves one tap right away, then confirms it on the line with an Undo for that stat. */
function recordWithFeedback(
  show: ShowAction,
  gameId: string,
  type: StatType,
  periodText: string,
): void {
  const saved = recordStat(gameId, type);
  const label = statLabel(type);
  show({
    message: `${label} · ${periodText}`,
    kind: STAT_DEFS[type].kind,
    actionLabel: 'Undo',
    onAction: once(() => removeStat(show, saved, label)),
  });
  saved.catch(() =>
    show({
      message: `Couldn't save ${label}`,
      tone: 'error',
      actionLabel: 'Retry',
      onAction: once(() => recordWithFeedback(show, gameId, type, periodText)),
    }),
  );
}

/** The grid's Undo: removes the game's latest stat, whatever it is. */
function undoLatest(show: ShowAction, gameId: string): void {
  undoLastStat(gameId).then(
    (removed) =>
      show({
        message: removed ? `Removed ${statLabel(removed.type)}` : 'Nothing to undo',
        tone: 'muted',
      }),
    () => show({ message: "Couldn't undo. Try again.", tone: 'error' }),
  );
}

/** Moves to another period, with an Undo back to where it was. */
function movePeriod(
  show: ShowAction,
  gameId: string,
  from: number,
  to: number,
  format: PeriodFormat,
): void {
  const toText = periodLabel(to, format);
  const fromText = periodLabel(from, format);
  setCurrentPeriod(gameId, to).catch(() =>
    show({ message: `Couldn't move to ${toText}`, tone: 'error' }),
  );
  show({
    message: `Now in ${toText}`,
    actionLabel: 'Undo',
    onAction: once(() => {
      show({ message: `Back in ${fromText}`, tone: 'muted' });
      setCurrentPeriod(gameId, from).catch(() =>
        show({ message: `Couldn't go back to ${fromText}`, tone: 'error' }),
      );
    }),
  });
}

type OpenSheet = 'period' | 'log' | 'end' | null;

/** The live tracking UI for a loaded game. */
function Tracker({ game, events }: { game: Game; events: StatEvent[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  // Bumped each time the end-game sheet opens, so its form starts fresh.
  const [endSheetKey, setEndSheetKey] = useState(0);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  useWakeLock();

  const { id: gameId, currentPeriod, periodFormat } = game;
  const periodText = periodLabel(currentPeriod, periodFormat);
  const isFinal = game.status === 'final';

  // Recording a stat changes `events`; only these two derive from it.
  const counts = useMemo(() => countByType(events), [events]);
  const line = useMemo(() => computeStatLine(events), [events]);

  const show = useCallback<ShowAction>((action) => {
    setLastAction((previous) => ({ ...action, key: (previous?.key ?? 0) + 1 }));
  }, []);

  // Stable across stats (they change only with the game or period), so the memoized
  // grid buttons re-render only when their own count changes.
  const record = useCallback(
    (type: StatType) => recordWithFeedback(show, gameId, type, periodText),
    [show, gameId, periodText],
  );
  const undo = useCallback(() => undoLatest(show, gameId), [show, gameId]);
  const nextPeriod = useCallback(
    () => movePeriod(show, gameId, currentPeriod, currentPeriod + 1, periodFormat),
    [show, gameId, currentPeriod, periodFormat],
  );
  const pickPeriod = useCallback(
    (period: number) => {
      setOpenSheet(null);
      if (period !== currentPeriod) {
        movePeriod(show, gameId, currentPeriod, period, periodFormat);
      }
    },
    [show, gameId, currentPeriod, periodFormat],
  );
  const openPeriods = useCallback(() => setOpenSheet('period'), []);
  const closeSheet = useCallback(() => setOpenSheet(null), []);

  const deleteFromLog = useCallback(
    async (event: StatEvent) => {
      const what = `${statLabel(event.type)} (${periodLabel(event.period, periodFormat)})`;
      const confirmed = await confirm({
        title: `Delete ${what}?`,
        message: `Recorded at ${formatClockTime(event.createdAt)}.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!confirmed) return;
      try {
        await deleteStat(event.id);
      } catch {
        toast.show({ message: `Couldn't delete ${what}. Try again.` });
        return;
      }
      toast.show({ message: `Deleted ${what}` });
      show({ message: `Deleted ${what}`, tone: 'muted' });
    },
    [confirm, toast, show, periodFormat],
  );

  const finishGame = useCallback(
    async (score: FinalScore) => {
      try {
        await endGame(gameId, score);
      } catch (error) {
        toast.show({ message: "Couldn't end the game. Try again." });
        throw error;
      }
      await navigate(paths.gameReport(gameId), { replace: true });
    },
    [gameId, navigate, toast],
  );

  // Before anything is tapped, the line shows the game's latest stat (e.g. after a
  // relaunch), or how to start.
  const latest = events.at(-1);
  const shownAction: LastAction =
    lastAction ??
    (latest
      ? {
          key: 0,
          message: `${statLabel(latest.type)} · ${periodLabel(latest.period, periodFormat)}`,
          kind: STAT_DEFS[latest.type].kind,
          actionLabel: 'Undo',
          onAction: once(() => removeStat(show, Promise.resolve(latest), statLabel(latest.type))),
        }
      : { key: 0, message: 'Tap a button to record a stat', tone: 'muted' });

  return (
    <>
      <main className={styles.screen}>
        <TopBar
          title={matchupTitle(game)}
          periodText={periodText}
          canAdvance={currentPeriod < MAX_PERIOD}
          onPickPeriod={openPeriods}
          onNextPeriod={nextPeriod}
        />
        {isFinal ? <p className={styles.banner}>Editing a finished game</p> : null}
        <StatStrip line={line} />
        {/*
          The shot chart (a later PR) slots in here, above the grid: the grid takes
          whatever height is left, so it shrinks to make room.
        */}
        <StatGrid counts={counts} onRecord={record} onUndo={undo} />
        <LastActionLine action={shownAction} />
        <div className={styles.bottomBar}>
          <Button variant="secondary" onClick={() => setOpenSheet('log')}>
            Log
          </Button>
          {isFinal ? (
            <ButtonLink to={paths.gameReport(gameId)} replace>
              Done
            </ButtonLink>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setEndSheetKey((key) => key + 1);
                setOpenSheet('end');
              }}
            >
              End game
            </Button>
          )}
        </div>
      </main>

      {/* Outside <main>: the sheets' text fields need the text selection <main> turns off. */}
      <PeriodSheet
        open={openSheet === 'period'}
        current={currentPeriod}
        periodFormat={periodFormat}
        onPick={pickPeriod}
        onClose={closeSheet}
      />
      <LogSheet
        open={openSheet === 'log'}
        events={events}
        periodFormat={periodFormat}
        onSelect={deleteFromLog}
        onClose={closeSheet}
      />
      <EndGameSheet
        key={endSheetKey}
        open={openSheet === 'end'}
        teamScore={game.teamScore}
        opponentScore={game.opponentScore}
        onEnd={finishGame}
        onClose={closeSheet}
      />
    </>
  );
}

/** A deleted game (or a stale link). The header's back link leads to Games. */
function GameNotFound() {
  return (
    <main>
      <ScreenHeader title="Live game" backTo={paths.home} backLabel="Games" />
      <ScreenBody>
        <EmptyState
          icon="🔍"
          title="Game not found"
          message="It may have been deleted. Tap Games to see the games on this phone."
        />
      </ScreenBody>
    </main>
  );
}

/**
 * Live game tracking: big one-tap stat buttons for a parent in a loud gym. Full
 * screen on purpose: no tab bar and no update banner may interrupt a live game.
 * Every tap is saved immediately; nothing here ever waits on the database first.
 */
export function TrackGameScreen() {
  const { gameId } = useParams();
  const game = useGame(gameId);
  const events = useGameEvents(gameId);

  if (game === null) return <GameNotFound />;
  // Still loading (IndexedDB answers within a frame or two): show nothing rather
  // than a placeholder layout that would jump.
  if (game === undefined || events === undefined) return null;
  return <Tracker key={game.id} game={game} events={events} />;
}
