import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/Button/Button';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useToast } from '@/components/Toast/toastContext';
import { useGame, useGameEvents } from '@/data/hooks';
import { endGame, type FinalScore } from '@/data/repo';
import { computeStatLine, periodLabel } from '@/data/stats';
import { MAX_PERIOD, type Game, type StatEvent, type StatType } from '@/data/types';
import { gameTitle } from '@/lib/gameTitle';
import { paths } from '@/routes';
import { EndGameSheet } from './EndGameSheet';
import { LastActionLine, type LastAction } from './LastActionLine';
import { LogSheet } from './LogSheet';
import { PeriodSheet } from './PeriodSheet';
import { StatGrid } from './StatGrid';
import { StatStrip } from './StatStrip';
import { TopBar } from './TopBar';
import {
  countByType,
  createTapGuard,
  FOUL_TROUBLE_AT,
  FOULED_OUT_AT,
  formatClockTime,
  statKind,
  statLabel,
} from './tracking';
import { UnsavedStats } from './UnsavedStats';
import { useTrackingSession } from './useTrackingSession';
import { useWakeLock } from './useWakeLock';
import styles from './TrackGameScreen.module.css';

/** Puts a message on the last-action line. */
type ShowAction = (action: Omit<LastAction, 'key'>) => void;

type OpenSheet = 'period' | 'log' | 'end' | null;

/** ' · 4 fouls' once she's in foul trouble, so the line says it right at the tap. */
function foulNote(fouls: number): string {
  if (fouls >= FOULED_OUT_AT) return ` · ${fouls} fouls, fouled out`;
  return fouls >= FOUL_TROUBLE_AT ? ` · ${fouls} fouls` : '';
}

/** The live tracking UI for a loaded game. */
function Tracker({ game, events }: { game: Game; events: StatEvent[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  // Bumped each time the end-game sheet opens, so its form starts fresh.
  const [endSheetKey, setEndSheetKey] = useState(0);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  // Bumped by the grid's Undo: the line's own Undo, just below it, then ignores taps
  // for a moment.
  const [lineHold, setLineHold] = useState(0);
  const [session, { period, unsaved, retrying }] = useTrackingSession(game.id, game.currentPeriod);
  // A double tap on the grid's Undo or on Next acts once.
  const [undoGuard] = useState(() => createTapGuard());
  const [nextGuard] = useState(() => createTapGuard());
  useWakeLock();

  const { id: gameId, periodFormat } = game;
  const periodText = periodLabel(period, periodFormat);
  const isFinal = game.status === 'final';

  // Recording a stat changes `events`; only these two derive from it.
  const counts = useMemo(() => countByType(events), [events]);
  const line = useMemo(() => computeStatLine(events), [events]);

  // Read by tap handlers, which stay stable so the grid doesn't re-render.
  const eventsRef = useRef(events);
  const foulsRef = useRef(counts.foul);
  useEffect(() => {
    eventsRef.current = events;
    foulsRef.current = counts.foul;
  }, [events, counts.foul]);

  const show = useCallback<ShowAction>((action) => {
    setLastAction((previous) => ({ ...action, key: (previous?.key ?? 0) + 1 }));
  }, []);

  /** Says a stat is gone right away, and speaks up if removing it fails. */
  const takeBack = useCallback(
    (label: string, removal: Promise<boolean>) => {
      show({ message: `Removed ${label}`, tone: 'muted' });
      void removal.then((removed) => {
        if (!removed) show({ message: `Couldn't remove ${label}. Try again.`, tone: 'error' });
      });
    },
    [show],
  );

  // Stable for the whole game (the period comes from the session at the tap), so the
  // memoized grid buttons re-render only when their own count changes.
  const record = useCallback(
    (type: StatType) => {
      const tap = session.record(type);
      const label = statLabel(type);
      const fouls = type === 'foul' ? foulNote(foulsRef.current + 1) : '';
      show({
        message: `${label} · ${periodLabel(tap.period, periodFormat)}${fouls}`,
        kind: statKind(type),
        tapId: tap.id,
        actionLabel: 'Undo',
        onAction: () => takeBack(label, session.undo(tap)),
      });
    },
    [session, show, takeBack, periodFormat],
  );

  const undo = useCallback((): boolean => {
    if (!undoGuard()) return false;
    const outcome = session.undoLatest(eventsRef.current);
    if (outcome === 'busy') return false;
    setLineHold((holds) => holds + 1);
    if (outcome === 'nothing') show({ message: 'Nothing to undo', tone: 'muted' });
    else takeBack(statLabel(outcome.type), outcome.done);
    return true;
  }, [session, show, takeBack, undoGuard]);

  /** Moves to another period at once (stats tapped next land there), with an Undo. */
  const moveTo = useCallback(
    (to: number) => {
      const from = session.getSnapshot().period;
      if (to === from) return;
      const toText = periodLabel(to, periodFormat);
      const fromText = periodLabel(from, periodFormat);
      const sayIfFailed = (message: string) => (moved: boolean) => {
        if (!moved) show({ message, tone: 'error' });
      };
      void session.movePeriod(to).then(sayIfFailed(`Couldn't move to ${toText}. Try again.`));
      show({
        message: `Now in ${toText}`,
        actionLabel: 'Undo',
        onAction: () => {
          show({ message: `Back in ${fromText}`, tone: 'muted' });
          void session
            .movePeriod(from)
            .then(sayIfFailed(`Couldn't go back to ${fromText}. Try again.`));
        },
      });
    },
    [session, show, periodFormat],
  );

  const nextPeriod = useCallback(() => {
    if (!nextGuard()) return;
    const current = session.getSnapshot().period;
    if (current < MAX_PERIOD) moveTo(current + 1);
  }, [session, moveTo, nextGuard]);
  const pickPeriod = useCallback(
    (to: number) => {
      setOpenSheet(null);
      moveTo(to);
    },
    [moveTo],
  );
  const openPeriods = useCallback(() => setOpenSheet('period'), []);
  const closeSheet = useCallback(() => setOpenSheet(null), []);
  const retry = useCallback(() => session.retry(), [session]);

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
      // The log shows it's gone; the line says so once the log is closed.
      if (await session.remove(event)) show({ message: `Deleted ${what}`, tone: 'muted' });
      else toast.show({ message: `Couldn't delete ${what}. Try again.` });
    },
    [confirm, toast, show, session, periodFormat],
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
  let shownAction: LastAction =
    lastAction ??
    (latest
      ? {
          key: 0,
          message: `${statLabel(latest.type)} · ${periodLabel(latest.period, periodFormat)}`,
          kind: statKind(latest.type),
          actionLabel: 'Undo',
          onAction: () => takeBack(statLabel(latest.type), session.remove(latest)),
        }
      : { key: 0, message: 'Tap a button to record a stat', tone: 'muted' });
  // The tap on the line couldn't be saved (yet): say so there too.
  const unsavedTap = unsaved.find((tap) => tap.id === shownAction.tapId);
  if (unsavedTap) {
    shownAction = {
      ...shownAction,
      message: `${statLabel(unsavedTap.type)} not saved`,
      kind: undefined,
      tone: 'error',
    };
  }

  return (
    <>
      <main className={styles.screen}>
        <TopBar
          title={gameTitle(game)}
          periodText={periodText}
          canAdvance={period < MAX_PERIOD}
          onPickPeriod={openPeriods}
          onNextPeriod={nextPeriod}
        />
        {isFinal ? <p className={styles.banner}>Editing a finished game</p> : null}
        <div className={styles.stripArea}>
          <StatStrip line={line} />
          <UnsavedStats unsaved={unsaved} retrying={retrying} onRetry={retry} />
        </div>
        {/*
          The shot chart (a later PR) slots in here, above the grid: the grid takes
          whatever height is left, so it shrinks to make room.
        */}
        <StatGrid counts={counts} onRecord={record} onUndo={undo} />
        <LastActionLine action={shownAction} holdKey={lineHold} />
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
        current={period}
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
 * Every tap is saved immediately; nothing here ever waits on the database first,
 * and a tap that couldn't be saved stays on screen until it is (see session.ts).
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
