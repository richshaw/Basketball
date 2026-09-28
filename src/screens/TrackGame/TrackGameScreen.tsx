import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/Button/Button';
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
import { NotSavedSheet } from './NotSavedSheet';
import { PeriodSheet } from './PeriodSheet';
import type { NotSaved, TakingBack, Tap } from './session';
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
  withTaps,
} from './tracking';
import { UnsavedStats } from './UnsavedStats';
import { useTrackingSession } from './useTrackingSession';
import { useWakeLock } from './useWakeLock';
import styles from './TrackGameScreen.module.css';

/** Puts a message on the last-action line. */
type ShowAction = (action: Omit<LastAction, 'key'>) => void;

type OpenSheet = 'period' | 'log' | 'end' | 'notSaved' | null;

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
  const [openSheet, setOpenSheetState] = useState<OpenSheet>(null);
  // Read after a wait (e.g. saving before the game ends): was the sheet closed meanwhile?
  const openSheetRef = useRef<OpenSheet>(null);
  const setOpenSheet = useCallback((sheet: OpenSheet) => {
    openSheetRef.current = sheet;
    setOpenSheetState(sheet);
  }, []);
  // Bumped each time the end-game sheet opens, so its form starts fresh.
  const [endSheetKey, setEndSheetKey] = useState(0);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  // Bumped by the grid's Undo: the line's own Undo, just below it, then ignores taps
  // for a moment.
  const [lineHold, setLineHold] = useState(0);
  // Done on a finished game: the stats that weren't saved, and whether it's busy.
  const [notSaved, setNotSaved] = useState<NotSaved | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [session, { period, pending, unsaved, unsavedKept, retrying, takenBack }] =
    useTrackingSession(game.id, game.currentPeriod, events);
  // A double tap on the grid's Undo or on Next acts once.
  const [undoGuard] = useState(() => createTapGuard());
  const [nextGuard] = useState(() => createTapGuard());
  useWakeLock();

  const { id: gameId, periodFormat } = game;
  const periodText = periodLabel(period, periodFormat);
  const isFinal = game.status === 'final';

  // The saved stats plus the taps not among them yet, each once, less the stats being
  // taken back: a tap counts from the moment it's made, saved yet or not, and stops
  // counting the moment it's undone, even while its stat is still being removed.
  const counted = useMemo(() => withTaps(events, pending, takenBack), [events, pending, takenBack]);
  const counts = useMemo(() => countByType(counted), [counted]);
  const line = useMemo(() => computeStatLine(counted), [counted]);

  const show = useCallback<ShowAction>((action) => {
    setLastAction((previous) => ({ ...action, key: (previous?.key ?? 0) + 1 }));
  }, []);

  /**
   * Says a stat is gone: at once for a tap not saved yet (it no longer counts), else
   * once its removal is done. Speaks up if it couldn't be removed.
   */
  const takeBack = useCallback(
    ({ type, immediate, removal }: TakingBack) => {
      const label = statLabel(type);
      if (immediate) show({ message: `Removed ${label}`, tone: 'muted' });
      void removal.then((result) => {
        if (result === 'failed') {
          show({ message: `Couldn't remove ${label}. Try again.`, tone: 'error' });
        } else if (!immediate) {
          const message =
            result === 'removed' ? `Removed ${label}` : `${label} was already removed`;
          show({ message, tone: 'muted' });
        }
      });
    },
    [show],
  );

  /** The line for one stat, e.g. '3PT Made · Q2', with an Undo for exactly that stat. */
  const statAction = useCallback(
    (stat: Pick<Tap, 'id' | 'type' | 'period'>, note = ''): Omit<LastAction, 'key'> => ({
      message: `${statLabel(stat.type)} · ${periodLabel(stat.period, periodFormat)}${note}`,
      kind: statKind(stat.type),
      tapId: stat.id,
      actionLabel: 'Undo',
      onAction: () => takeBack(session.undo(stat)),
    }),
    [session, takeBack, periodFormat],
  );

  // Stable for the whole game (the period comes from the session at the tap), so the
  // memoized grid buttons re-render only when their own count changes.
  const record = useCallback(
    (type: StatType) => {
      const tap = session.record(type);
      // Counted by the session, taps not saved yet included, so two quick fouls after
      // three say 4 and then 5, before the saved stats on screen catch up.
      show(statAction(tap, type === 'foul' ? foulNote(session.count('foul')) : ''));
    },
    [session, show, statAction],
  );

  const undo = useCallback((): boolean => {
    if (!undoGuard()) return false;
    const outcome = session.undoLatest();
    if (outcome === 'busy') return false;
    setLineHold((holds) => holds + 1);
    void outcome.then((taking) => {
      if (taking === 'nothing') show({ message: 'Nothing to undo', tone: 'muted' });
      else takeBack(taking);
    });
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
    [moveTo, setOpenSheet],
  );
  const openPeriods = useCallback(() => setOpenSheet('period'), [setOpenSheet]);
  const closeSheet = useCallback(() => setOpenSheet(null), [setOpenSheet]);
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
      const result = await session.undo(event).removal;
      if (result === 'removed') show({ message: `Deleted ${what}`, tone: 'muted' });
      else if (result === 'gone') show({ message: `${what} was already deleted`, tone: 'muted' });
      else toast.show({ message: `Couldn't delete ${what}. Try again.` });
    },
    [confirm, toast, show, session, periodFormat],
  );

  // End game: every stat is saved first, unless it's "End anyway" (kept stats are
  // saved later on their own).
  const finishGame = useCallback(
    async (score: FinalScore, anyway: boolean): Promise<NotSaved | null> => {
      if (!anyway) {
        const left = await session.saveAll();
        // "Keep tracking" was tapped while it saved: the game goes on.
        if (openSheetRef.current !== 'end') return null;
        if (left.count > 0) return left;
      }
      try {
        await endGame(gameId, score);
      } catch (error) {
        toast.show({ message: "Couldn't end the game. Try again." });
        throw error;
      }
      await navigate(paths.gameReport(gameId), { replace: true });
      return null;
    },
    [gameId, navigate, session, toast],
  );

  // Done, on a finished game: the same, with its own "not saved yet" sheet.
  const leave = async (anyway: boolean) => {
    if (leaving) return;
    const sheet = openSheetRef.current;
    setLeaving(true);
    try {
      if (!anyway) {
        const left = await session.saveAll();
        // Its sheet was closed (or another opened) while it saved: stay.
        if (openSheetRef.current !== sheet) return;
        if (left.count > 0) {
          setNotSaved(left);
          setOpenSheet('notSaved');
          return;
        }
      }
      await navigate(paths.gameReport(gameId), { replace: true });
    } finally {
      setLeaving(false);
    }
  };

  // Before anything is tapped, the line shows the game's latest stat (after a
  // relaunch, maybe a tap an earlier page couldn't save), or how to start.
  const latestSaved = events.at(-1);
  const latestTap = pending.at(-1);
  let shownAction: LastAction = { key: 0, message: 'Tap a button to record a stat', tone: 'muted' };
  if (lastAction) {
    shownAction = lastAction;
  } else if (latestTap && !(latestSaved && latestSaved.createdAt >= latestTap.at)) {
    shownAction = { key: 0, ...statAction(latestTap) };
  } else if (latestSaved) {
    shownAction = { key: 0, ...statAction(latestSaved) };
  }
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
          <UnsavedStats unsaved={unsaved} kept={unsavedKept} retrying={retrying} onRetry={retry} />
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
            <Button disabled={leaving} onClick={() => void leave(false)}>
              Done
            </Button>
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
      <NotSavedSheet
        open={openSheet === 'notSaved'}
        notSaved={notSaved}
        busy={leaving}
        onTryAgain={() => void leave(false)}
        onDoneAnyway={() => void leave(true)}
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
 * Every tap is kept on the phone and saved at once; nothing here ever waits on the
 * database first, and a tap that couldn't be saved stays on screen until it is (see
 * session.ts), even across a relaunch.
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
