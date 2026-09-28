/**
 * The live game screen's taps and period, kept outside React (one session per game,
 * for as long as the page is open), so no tap is lost to a re-render or to leaving
 * the screen and coming back.
 *
 * - Every tap is saved at once, into the period on screen when it was tapped.
 * - A tap that can't be saved is kept, and tried again: once on its own after
 *   AUTO_RETRY_MS, then before each new tap, when the page is shown again, and on
 *   Retry. The screen lists these taps until they're saved, whatever is tapped next.
 * - Undo takes back one particular tap, saved or not. A tap that was undone is
 *   never retried, and is removed once its save lands.
 * - The period moves on screen at once and is then saved; the saved period takes
 *   over again once no move is being saved (or a move couldn't be saved).
 */
import { deleteStat, recordStat, setCurrentPeriod } from '@/data/repo';
import type { StatEvent, StatType } from '@/data/types';

/** How long after a tap couldn't be saved it's tried again on its own. */
export const AUTO_RETRY_MS = 1000;

/** The writes a session makes (the repository's, or fakes in tests). */
export interface SessionDeps {
  recordStat(gameId: string, type: StatType, period: number): Promise<StatEvent>;
  deleteStat(eventId: string): Promise<StatEvent | undefined>;
  setCurrentPeriod(gameId: string, period: number): Promise<unknown>;
}

// Looked up on each call (not captured), so tests can spy on the repository.
const repoDeps: SessionDeps = {
  recordStat: (gameId, type, period) => recordStat(gameId, type, undefined, { period }),
  deleteStat: (eventId) => deleteStat(eventId),
  setCurrentPeriod: (gameId, period) => setCurrentPeriod(gameId, period),
};

/** One tap of a stat button. */
export interface Tap {
  readonly id: number;
  readonly type: StatType;
  /** The period on screen at the tap: the stat is saved there, even by a later retry. */
  readonly period: number;
}

interface TapRecord extends Tap {
  status: 'saving' | 'saved' | 'failed';
  /** A save of this tap has failed at least once. */
  hasFailed: boolean;
  /** Taken back: never retried, and removed once saved. */
  undone: boolean;
  event?: StatEvent;
  /** Settles (never rejects) once the save under way is done. */
  settled: Promise<void>;
}

export interface SessionSnapshot {
  /** The period on screen. */
  readonly period: number;
  /** Taps that couldn't be saved yet, oldest first. */
  readonly unsaved: readonly Tap[];
  /** Some of them are being saved again right now. */
  readonly retrying: boolean;
}

/** What the grid's Undo did: removing a stat of `type` (done: true once it's gone). */
export type UndoLatestOutcome = { type: StatType; done: Promise<boolean> } | 'nothing' | 'busy';

/** Calls a write, turning a synchronous throw into a rejection. */
function attempt<T>(write: () => Promise<T>): Promise<T> {
  try {
    return write();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function sameTaps(a: readonly Tap[], b: readonly Tap[]): boolean {
  return a.length === b.length && a.every((tap, index) => tap.id === b[index]?.id);
}

export class TrackingSession {
  private readonly taps: TapRecord[] = [];
  /** Saved stats removed through this session (their deletion may still be under way). */
  private readonly removedIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private nextTapId = 1;
  private period: number;
  private savedPeriod: number;
  private movesInFlight = 0;
  private undoInFlight = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: SessionSnapshot;
  readonly gameId: string;
  private readonly deps: SessionDeps;

  constructor(gameId: string, period: number, deps: SessionDeps = repoDeps) {
    this.gameId = gameId;
    this.deps = deps;
    this.period = period;
    this.savedPeriod = period;
    this.snapshot = { period, unsaved: [], retrying: false };
  }

  /** For useSyncExternalStore. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** For useSyncExternalStore: the same object until something on screen changes. */
  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  private emit(): void {
    const unsaved = this.taps.filter(
      (tap) => tap.hasFailed && tap.status !== 'saved' && !tap.undone,
    );
    const retrying = unsaved.some((tap) => tap.status === 'saving');
    const previous = this.snapshot;
    if (
      previous.period === this.period &&
      previous.retrying === retrying &&
      sameTaps(previous.unsaved, unsaved)
    ) {
      return;
    }
    this.snapshot = {
      period: this.period,
      unsaved: unsaved.map(({ id, type, period }) => ({ id, type, period })),
      retrying,
    };
    for (const listener of this.listeners) listener();
  }

  /** Records a tap in the period on screen, after retrying any taps not saved yet. */
  record(type: StatType): Tap {
    this.retry();
    const tap: TapRecord = {
      id: this.nextTapId++,
      type,
      period: this.period,
      status: 'saving',
      hasFailed: false,
      undone: false,
      settled: Promise.resolve(),
    };
    this.taps.push(tap);
    this.save(tap);
    return { id: tap.id, type, period: tap.period };
  }

  private save(tap: TapRecord): void {
    tap.status = 'saving';
    tap.settled = attempt(() => this.deps.recordStat(this.gameId, tap.type, tap.period)).then(
      (event) => {
        tap.status = 'saved';
        tap.event = event;
        this.emit();
      },
      () => {
        const firstFailure = !tap.hasFailed;
        tap.status = 'failed';
        tap.hasFailed = true;
        if (firstFailure && !tap.undone) this.scheduleRetry();
        this.emit();
      },
    );
    this.emit();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== undefined) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retry();
    }, AUTO_RETRY_MS);
  }

  /** Tries again to save the taps that couldn't be saved (not ones undone or saving). */
  retry(): void {
    for (const tap of this.taps) {
      if (tap.status === 'failed' && !tap.undone) this.save(tap);
    }
  }

  /**
   * Takes back one tap: drops it if it was never saved, or removes its stat once
   * saved. Resolves to false if the stat couldn't be removed (the tap counts again).
   * Taking back a tap twice does nothing the second time.
   */
  undo(tap: Tap): Promise<boolean> {
    const record = this.taps.find((each) => each.id === tap.id);
    if (!record || record.undone) return Promise.resolve(true);
    record.undone = true;
    this.emit();
    return record.settled.then(() => this.removeSaved(record));
  }

  private removeSaved(record: TapRecord): Promise<boolean> {
    if (record.status !== 'saved' || !record.event) return Promise.resolve(true);
    return this.deleteEvent(record.event).then((removed) => {
      if (!removed) {
        record.undone = false;
        this.emit();
      }
      return removed;
    });
  }

  private deleteEvent(event: StatEvent): Promise<boolean> {
    this.removedIds.add(event.id);
    return attempt(() => this.deps.deleteStat(event.id)).then(
      () => true,
      () => {
        this.removedIds.delete(event.id);
        return false;
      },
    );
  }

  /**
   * Removes one saved stat (from the log, or the line's Undo for a stat recorded
   * before this session). Resolves to false if it couldn't be removed.
   */
  remove(event: StatEvent): Promise<boolean> {
    const tap = this.taps.find((each) => each.event?.id === event.id);
    if (tap) return this.undo(tap);
    if (this.removedIds.has(event.id)) return Promise.resolve(true);
    return this.deleteEvent(event);
  }

  /**
   * The grid's Undo: takes back the latest tap that still counts, saved or not;
   * with none left, removes the latest stat in `events` (the game's saved stats,
   * oldest first) recorded before this session. 'busy' while an Undo's removal is
   * still under way, so a double tap can't take away two stats.
   */
  undoLatest(events: readonly StatEvent[]): UndoLatestOutcome {
    if (this.undoInFlight) return 'busy';
    const tap = this.taps.findLast((each) => !each.undone);
    if (tap && tap.status !== 'saved') {
      // Not saved (yet): dropped now, or removed in the background once it's saved.
      return { type: tap.type, done: this.undo(tap) };
    }
    let type: StatType;
    let done: Promise<boolean>;
    if (tap) {
      type = tap.type;
      done = this.undo(tap);
    } else {
      const ownIds = new Set(this.taps.flatMap((each) => (each.event ? [each.event.id] : [])));
      const target = events.findLast(
        (event) => !ownIds.has(event.id) && !this.removedIds.has(event.id),
      );
      if (!target) return 'nothing';
      type = target.type;
      done = this.deleteEvent(target);
    }
    this.undoInFlight = true;
    void done.then(() => {
      this.undoInFlight = false;
    });
    return { type, done };
  }

  /**
   * Moves to another period: on screen at once, then saved. Resolves to false if it
   * couldn't be saved (the saved period is shown again, unless another move is on
   * its way).
   */
  movePeriod(to: number): Promise<boolean> {
    this.period = to;
    this.movesInFlight += 1;
    this.emit();
    return attempt(() => this.deps.setCurrentPeriod(this.gameId, to)).then(
      () => {
        this.movesInFlight -= 1;
        return true;
      },
      () => {
        this.movesInFlight -= 1;
        if (this.movesInFlight === 0) {
          this.period = this.savedPeriod;
          this.emit();
        }
        return false;
      },
    );
  }

  /** The game's period as saved (it changes when a move lands, or elsewhere). */
  syncSavedPeriod(period: number): void {
    this.savedPeriod = period;
    if (this.movesInFlight === 0) {
      this.period = period;
      this.emit();
    }
  }
}

const sessions = new Map<string, TrackingSession>();

/** The session of a game, made on first use; it lasts as long as the page. */
export function trackingSession(gameId: string, period: number): TrackingSession {
  let session = sessions.get(gameId);
  if (!session) {
    session = new TrackingSession(gameId, period);
    sessions.set(gameId, session);
  }
  return session;
}
