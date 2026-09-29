import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/Button/Button';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { useToast } from '@/components/Toast/toastContext';
import { useReloadSafe, useSteadyGame, useSteadyGameEvents, useSteadySettings } from '@/data/hooks';
import { endGame, type FinalScore } from '@/data/repo';
import { shotsFromEvents } from '@/data/shots';
import { computeStatLine, periodLabel } from '@/data/stats';
import {
  MAX_PERIOD,
  type CourtPoint,
  type Game,
  type StatEvent,
  type StatType,
} from '@/data/types';
import { cx } from '@/lib/cx';
import { gameTitle } from '@/lib/gameTitle';
import { paths } from '@/routes';
import { EndGameSheet } from './EndGameSheet';
import { LastActionLine, type LastAction } from './LastActionLine';
import { LogSheet } from './LogSheet';
import { NotSavedSheet } from './NotSavedSheet';
import { PeriodSheet } from './PeriodSheet';
import { ReadFailedNote } from './ReadFailedNote';
import type { NotSaved, TakingBack, Tap } from './session';
import { ShotCourt } from './ShotCourt';
import { StatGrid } from './StatGrid';
import { StatStrip } from './StatStrip';
import { TopBar } from './TopBar';
import {
  countByType,
  createTapGuard,
  FOUL_TROUBLE_AT,
  FOULED_OUT_AT,
  formatClockTime,
  spotNote,
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

interface TrackerProps {
  game: Game;
  /** The game's saved stats, oldest first. */
  events: StatEvent[];
  /** The latest read of the game or its stats failed: `game` and `events` are the last read. */
  readFailed: boolean;
  /** The Shot chart setting: whether the court is shown to mark where shots were taken. */
  shotChart: boolean;
}

/** The live tracking UI for a loaded game. */
function Tracker({ game, events, readFailed, shotChart }: TrackerProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  // Set as the screen opens: the court never comes or goes (moving the buttons) while
  // it's open, even if the setting is changed meanwhile (e.g. in another tab).
  const [withCourt] = useState(shotChart);
  // Bumped by a tap on the court with no shot to mark: the court says how it works.
  const [courtHint, setCourtHint] = useState(0);
  const [openSheet, setOpenSheetState] = useState<OpenSheet>(null);
  // Moves on whenever a sheet opens or closes, and when the screen closes. A wait (e.g.
  // saving before the game ends) goes on only if it hasn't moved since the wait began:
  // a request taken back ("Keep tracking", the Games link) never comes back, not even
  // under a sheet opened again meanwhile.
  const sheetTurn = useRef(0);
  const setOpenSheet = useCallback((sheet: OpenSheet) => {
    sheetTurn.current += 1;
    setOpenSheetState(sheet);
  }, []);
  useEffect(() => {
    const turn = sheetTurn;
    return () => {
      turn.current += 1;
    };
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
  const [session, { period, pending, unsaved, unsavedKept, retrying, takenBack, spotShot }] =
    useTrackingSession(game.id, game.currentPeriod, events);
  // Whether a reload would lose nothing: not this game's taps, spots, Undos or period
  // moves, nor another game's that only this page holds.
  const reloadSafe = useReloadSafe();
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
  // The game's shots on the court, faintly: all but the one being marked (shown as the pick).
  const markingId = spotShot?.tap.id;
  const courtShots = useMemo(
    () => (withCourt ? shotsFromEvents(counted.filter((stat) => stat.id !== markingId)) : []),
    [withCourt, counted, markingId],
  );

  const show = useCallback<ShowAction>((action) => {
    setLastAction((previous) => ({ ...action, key: (previous?.key ?? 0) + 1 }));
  }, []);

  /**
   * Says a stat is gone: at once for a tap not saved yet (it no longer counts), else
   * once its removal is done. Speaks up if it couldn't be removed (it counts again), with
   * Try again for exactly that stat: short enough to fit the line on the smallest iPhone.
   */
  const takeBack = useMemo(() => {
    const follow = ({ id, type, immediate, removal }: TakingBack): void => {
      const label = statLabel(type);
      if (immediate) show({ message: `Removed ${label}`, tone: 'muted' });
      void removal.then((result) => {
        if (result === 'failed') {
          show({
            message: "Couldn't undo",
            tone: 'error',
            actionLabel: 'Try again',
            onAction: () => follow(session.undo({ id, type })),
          });
        } else if (!immediate) {
          const message =
            result === 'removed' ? `Removed ${label}` : `${label} was already removed`;
          show({ message, tone: 'muted' });
        }
      });
    };
    return follow;
  }, [session, show]);

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

  // A tap on the court marks the spot of the shot on the line (the session saves it with
  // that shot). With no shot to mark, the court says to tap 2PT or 3PT first.
  const markSpot = useCallback(
    (point: CourtPoint) => {
      if (!session.markSpot(point)) setCourtHint((hints) => hints + 1);
    },
    [session],
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

  /**
   * Moves to another period at once (stats tapped next land there), with an Undo. A move
   * (or its Undo) that couldn't be saved puts the saved period back on screen, and the
   * line says so with Try again for that move: short enough to fit beside its button on
   * the smallest iPhone, even for a double-digit overtime.
   */
  const moveTo = useMemo(() => {
    const move = (to: number): void => {
      const from = session.getSnapshot().period;
      if (to === from) return;
      const sayIfFailed = (target: number) => (moved: boolean) => {
        if (moved) return;
        show({
          message: `Couldn't go to ${periodLabel(target, periodFormat)}`,
          tone: 'error',
          actionLabel: 'Try again',
          onAction: () => move(target),
        });
      };
      void session.movePeriod(to).then(sayIfFailed(to));
      show({
        message: `Now in ${periodLabel(to, periodFormat)}`,
        actionLabel: 'Undo',
        onAction: () => {
          show({ message: `Back in ${periodLabel(from, periodFormat)}`, tone: 'muted' });
          void session.movePeriod(from).then(sayIfFailed(from));
        },
      });
    };
    return move;
  }, [session, show, periodFormat]);

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
      // (Without its period, to fit the line whole on the smallest iPhone.)
      else if (result === 'gone') {
        show({ message: `${statLabel(event.type)} was already deleted`, tone: 'muted' });
      } else toast.show({ message: `Couldn't delete ${what}. Try again.` });
    },
    [confirm, toast, show, session, periodFormat],
  );

  // End game: every stat is saved first, unless it's "End anyway" (kept stats are
  // saved later on their own).
  const finishGame = useCallback(
    async (score: FinalScore, anyway: boolean): Promise<NotSaved | null> => {
      const turn = sheetTurn.current;
      if (!anyway) {
        const left = await session.saveAll();
        // "Keep tracking" was tapped while it saved (even if End game was opened again
        // since): the game goes on.
        if (sheetTurn.current !== turn) return null;
        if (left.count > 0) return left;
      }
      try {
        await endGame(gameId, score);
      } catch (error) {
        toast.show({ message: "Couldn't end the game. Try again." });
        throw error;
      }
      // Ended, but "Keep tracking" was tapped meanwhile: stay, on the finished game.
      if (sheetTurn.current === turn) await navigate(paths.gameReport(gameId), { replace: true });
      return null;
    },
    [gameId, navigate, session, toast],
  );

  // Done, on a finished game: the same, with its own "not saved yet" sheet.
  const leave = async (anyway: boolean) => {
    if (leaving) return;
    const turn = sheetTurn.current;
    setLeaving(true);
    try {
      if (!anyway) {
        const left = await session.saveAll();
        // A sheet was opened or closed while it saved, or the screen was left (e.g. for
        // Games): stay where the parent went.
        if (sheetTurn.current !== turn) return;
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
  // A shot on the line: how to mark its spot while the court takes it, then that it's marked.
  const shotOnLine = withCourt ? counted.find((stat) => stat.id === shownAction.tapId) : undefined;
  if (shotOnLine) {
    const marking = spotShot?.tap.id === shotOnLine.id ? spotShot : null;
    const detail = spotNote(
      shotOnLine.type,
      marking ? marking.spot : shotOnLine.location,
      marking !== null,
    );
    if (detail) shownAction = { ...shownAction, detail };
  }

  return (
    <>
      <main className={cx(styles.screen, withCourt && styles.withCourt)}>
        <TopBar
          title={gameTitle(game)}
          periodText={periodText}
          canAdvance={period < MAX_PERIOD}
          onPickPeriod={openPeriods}
          onNextPeriod={nextPeriod}
        />
        {isFinal ? <p className={styles.banner}>Editing a finished game</p> : null}
        <div className={styles.stripArea}>
          <StatStrip line={line} compact={withCourt} />
          {/* A tap not saved and not kept keeps its own row: it asks to keep the app open. */}
          {readFailed && (unsaved.length === 0 || unsavedKept) ? (
            // Reload only while it would lose nothing.
            <ReadFailedNote canReload={reloadSafe} compact={withCourt} />
          ) : (
            <UnsavedStats
              unsaved={unsaved}
              kept={unsavedKept}
              retrying={retrying}
              onRetry={retry}
              compact={withCourt}
            />
          )}
        </div>
        {withCourt ? (
          <ShotCourt shots={courtShots} spotShot={spotShot} onPick={markSpot} hintKey={courtHint} />
        ) : null}
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
 * session.ts), even across a relaunch. A read of the saved stats that fails doesn't
 * take the screen down either: it keeps what it read last, says so calmly, and reads
 * again on its own.
 */
export function TrackGameScreen() {
  const { gameId } = useParams();
  const game = useSteadyGame(gameId);
  const events = useSteadyGameEvents(gameId);
  // (The Shot chart setting: read as steadily, so a failed read can't take the screen
  // down either.)
  const settings = useSteadySettings();

  if (game.value === null) return <GameNotFound />;
  if (game.value === undefined || events.value === undefined || settings.value === undefined) {
    // Nothing on screen to keep yet: a first read that failed gets the route's error
    // screen (with Reload), like any other screen.
    if (game.failed) throw game.error;
    if (events.failed) throw events.error;
    if (settings.failed) throw settings.error;
    // Still loading (IndexedDB answers within a frame or two): show nothing rather
    // than a placeholder layout that would jump (the shot chart's court included).
    return null;
  }
  return (
    <Tracker
      key={game.value.id}
      game={game.value}
      events={events.value}
      readFailed={game.failed || events.failed}
      shotChart={settings.value.shotChart}
    />
  );
}
