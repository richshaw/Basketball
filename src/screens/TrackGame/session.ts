/**
 * The live game screen's taps and period, kept outside React (one session per game,
 * for as long as the page is open), so no tap is lost to a re-render or to leaving
 * the screen and coming back.
 *
 * - A tap gets its stat's id and tap time at once, is kept in the pending-stats
 *   journal (src/data/pendingStats.ts, in localStorage, so it outlives the page), and
 *   is then saved into the period on screen when it was tapped. Saving is idempotent
 *   by id, so a retry can never add it twice, whatever its earlier write did.
 * - A tap that can't be saved stays kept, and is tried again: once on its own after
 *   AUTO_RETRY_MS, then before each new tap, when the page is shown again, and on
 *   Retry. The screen lists these taps until they're saved. A new session (e.g. after
 *   a reload) starts with the taps an earlier page kept for its game.
 * - The app-wide retry (src/data/pendingSaves.ts) also tries them again, quietly, for
 *   as long as the page is open, whether or not the screen is: sessions made by
 *   trackingSession() hold their taps for it (holdUnsavedTaps), including any the
 *   journal couldn't keep.
 * - The session holds a tap only until it's among the saved stats the screen shows
 *   (syncSavedEvents): saved stats are the database's business. Undo takes back the
 *   most recent stat by tap time, a tap or a saved stat; one that turns out to be gone
 *   already is skipped, and never reported as removed.
 * - The period moves on screen at once and is then saved; the saved period takes
 *   over again once no move is being saved (or a move couldn't be saved).
 */
import { savePendingStat } from '@/data/pendingSaves';
import {
  addPendingStat,
  holdUnsavedTaps,
  isPendingStat,
  listPendingStats,
  newPendingStat,
  notifyPendingStats,
  removePendingStat,
  type PendingStat,
  type UnsavedTapHolder,
} from '@/data/pendingStats';
import { deleteStat, setCurrentPeriod } from '@/data/repo';
import type { StatEvent, StatType } from '@/data/types';
import { compareIds } from '@/lib/id';
import { waitAtMost } from '@/lib/wait';

/** How long after a tap couldn't be saved it's tried again on its own. */
export const AUTO_RETRY_MS = 1000;

/** How long saveAll() waits for saves under way before counting them as not saved. */
export const SAVE_ALL_WAIT_MS = 3000;

/** The writes a session makes (the repository's, or fakes in tests). */
export interface SessionDeps {
  /** Saves a tap as its stat. Must be idempotent by the tap's id, like recordStat. */
  recordStat(stat: PendingStat): Promise<StatEvent>;
  deleteStat(eventId: string): Promise<StatEvent | undefined>;
  setCurrentPeriod(gameId: string, period: number): Promise<unknown>;
}

// Looked up on each call (not captured), so tests can spy on the repository.
const repoDeps: SessionDeps = {
  recordStat: (stat) => savePendingStat(stat),
  deleteStat: (eventId) => deleteStat(eventId),
  setCurrentPeriod: (gameId, period) => setCurrentPeriod(gameId, period),
};

/** One tap of a stat button. */
export interface Tap {
  /** Its stat's id: the event it's saved as. */
  readonly id: string;
  readonly type: StatType;
  /** The period on screen at the tap: the stat is saved there, even by a later retry. */
  readonly period: number;
  /** When it was tapped (epoch ms): its stat's createdAt, however late it's saved. */
  readonly at: number;
}

interface TapRecord {
  readonly stat: PendingStat;
  /**
   * 'saving': a save is under way. 'saved': one landed. 'failed': neither, so it's
   * tried again: the last save failed, or (a tap an earlier page kept) none was tried
   * on this page yet.
   */
  status: 'saving' | 'failed' | 'saved';
  /**
   * A save of it has failed on this page: it's listed as not saved until one lands. Not
   * before, so a tap an earlier page kept isn't called "not saved" before it's tried.
   */
  hasFailed: boolean;
  /** It's in the journal, so it outlives the page. */
  kept: boolean;
  /** Tried again on its own already (that happens once). */
  autoRetried: boolean;
  /**
   * The save under way is the app-wide retry's, in the background: the screen doesn't
   * say it's saving again (unless Retry is tapped meanwhile).
   */
  quiet: boolean;
  /** Settles (never rejects) once the save under way is done. */
  settled: Promise<void>;
  /** Taken back: never saved again, and its stat removed if a save landed anyway. */
  undone: boolean;
  /** How taking it back went, once it has been. */
  removal?: Promise<Removal>;
  /**
   * Taken back before any save of it was confirmed, but removing its stat by id (in
   * case a save landed after all) failed: tried again with the next retry, or when
   * the stat shows up among the saved ones.
   */
  orphan: boolean;
}

/** How removing a stat went. */
export type Removal =
  /** It's gone: it doesn't count any more. */
  | 'removed'
  /** It was gone already (e.g. deleted on another screen): nothing was removed. */
  | 'gone'
  /** It couldn't be removed: it still counts. */
  | 'failed';

/** A stat that Undo (or the log) is taking back. */
export interface TakingBack {
  readonly type: StatType;
  /**
   * The tap was taken back at once (it no longer counts): true for a tap not
   * confirmed saved. False for a saved stat, which only goes once `removal` says so.
   */
  readonly immediate: boolean;
  /** Settles once its stat is dealt with; 'failed' if it counts again. */
  readonly removal: Promise<Removal>;
}

/** Stats that aren't saved yet when the game is ended (see saveAll). */
export interface NotSaved {
  readonly count: number;
  /** All of them are kept in the journal, so they'll be saved later even if the app closes. */
  readonly kept: boolean;
}

export interface SessionSnapshot {
  /** The period on screen. */
  readonly period: number;
  /**
   * Taps that count but aren't among the saved stats yet (being saved, not saved, or
   * saved a moment ago), in tap order.
   */
  readonly pending: readonly Tap[];
  /** The ones that couldn't be saved yet, in tap order. */
  readonly unsaved: readonly Tap[];
  /** Every one of those is kept in the journal (on this phone, even across a relaunch). */
  readonly unsavedKept: boolean;
  /**
   * Every tap that isn't confirmed saved (being saved or not) is kept in the journal, so
   * a reload would lose none.
   */
  readonly allKept: boolean;
  /** Some of them are being saved again right now (not counting quiet background tries). */
  readonly retrying: boolean;
  /**
   * Stats being taken back, by id (taps undone, and saved stats being removed), sorted:
   * they don't count, even while the saved stats on screen still show them.
   */
  readonly takenBack: readonly string[];
}

/** Calls a write, turning a synchronous throw into a rejection. */
function attempt<T>(write: () => Promise<T>): Promise<T> {
  try {
    return write();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function tapOf({ stat }: TapRecord): Tap {
  return { id: stat.id, type: stat.type, period: stat.period, at: stat.at };
}

function sameTaps(taps: readonly Tap[], records: readonly TapRecord[]): boolean {
  return (
    taps.length === records.length && taps.every((tap, index) => tap.id === records[index]?.stat.id)
  );
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isTapRecord(item: TapRecord | StatEvent): item is TapRecord {
  return 'stat' in item;
}

export class TrackingSession implements UnsavedTapHolder {
  /** Taps not among the saved stats yet, and taken-back taps still being dealt with. */
  private taps: TapRecord[] = [];
  /** The game's saved stats, oldest first, as the screen last showed them. */
  private saved: readonly StatEvent[] = [];
  private savedIds = new Set<string>();
  /** Saved stats removed (or being removed) through this session, until they're gone. */
  private readonly removing = new Set<string>();
  /** The removals under way, by stat id. */
  private readonly removals = new Map<string, Promise<Removal>>();
  /** The latest tap time given out or seen, so the next tap sorts after it. */
  private lastAt: number | undefined;
  private readonly listeners = new Set<() => void>();
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
    // Taps an earlier page kept but couldn't save (or didn't hear back about): counted
    // at once, and saved by the next retry (the screen retries as it opens). Only a
    // save that fails here lists one as not saved.
    for (const stat of listPendingStats(gameId)) {
      this.taps.push({
        stat,
        status: 'failed',
        hasFailed: false,
        kept: true,
        autoRetried: false,
        quiet: false,
        settled: Promise.resolve(),
        undone: false,
        orphan: false,
      });
      this.lastAt = Math.max(this.lastAt ?? stat.at, stat.at);
    }
    this.snapshot = this.nextSnapshot();
  }

  /** For useSyncExternalStore. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** For useSyncExternalStore: the same object until something on screen changes. */
  readonly getSnapshot = (): SessionSnapshot => this.snapshot;

  private nextSnapshot(): SessionSnapshot {
    const pending = this.taps.filter((record) => !record.undone);
    const unsaved = pending.filter((record) => record.hasFailed && record.status !== 'saved');
    const unsavedKept = unsaved.every((record) => record.kept);
    const allKept = pending.every((record) => record.kept || record.status === 'saved');
    const retrying = unsaved.some((record) => record.status === 'saving' && !record.quiet);
    const takenBack = [
      ...new Set([
        ...this.taps.filter((record) => record.undone).map((record) => record.stat.id),
        ...this.removing,
      ]),
    ].sort(compareIds);
    const previous = this.snapshot as SessionSnapshot | undefined;
    if (
      previous?.period === this.period &&
      previous.unsavedKept === unsavedKept &&
      previous.allKept === allKept &&
      previous.retrying === retrying &&
      sameTaps(previous.pending, pending) &&
      sameTaps(previous.unsaved, unsaved) &&
      sameIds(previous.takenBack, takenBack)
    ) {
      return previous;
    }
    return {
      period: this.period,
      pending: pending.map(tapOf),
      unsaved: unsaved.map(tapOf),
      unsavedKept,
      allKept,
      retrying,
      takenBack,
    };
  }

  private emit(): void {
    const next = this.nextSnapshot();
    if (next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  /** Stops holding a tap. */
  private drop(record: TapRecord): void {
    this.taps = this.taps.filter((each) => each !== record);
    this.emit();
  }

  /**
   * The game's saved stats, oldest first, as the screen shows them (they change when a
   * save lands, or elsewhere). Taps among them are the database's from here on.
   */
  syncSavedEvents(events: readonly StatEvent[]): void {
    this.saved = events;
    this.savedIds = new Set(events.map((event) => event.id));
    const newest = events.at(-1)?.createdAt;
    if (newest !== undefined) this.lastAt = Math.max(this.lastAt ?? newest, newest);
    for (const id of this.removing) {
      if (!this.savedIds.has(id)) this.removing.delete(id);
    }
    for (const record of this.taps) {
      if (!this.savedIds.has(record.stat.id)) continue;
      if (!record.undone) {
        // Saved, whatever its own write said: nothing left to keep.
        removePendingStat(record.stat.id);
      } else if (record.orphan) {
        // A tap taken back whose save landed after all: remove it again.
        void this.removeOrphan(record);
      }
    }
    this.taps = this.taps.filter((record) => record.undone || !this.savedIds.has(record.stat.id));
    this.emit();
  }

  /** Records a tap in the period on screen, after retrying any taps not saved yet. */
  record(type: StatType): Tap {
    this.retry();
    const stat = newPendingStat({ gameId: this.gameId, type, period: this.period }, this.lastAt);
    this.lastAt = stat.at;
    // Kept before its write starts, so it outlives the page even if the write never lands.
    const kept = addPendingStat(stat);
    const record: TapRecord = {
      stat,
      status: 'saving',
      hasFailed: false,
      kept,
      autoRetried: false,
      quiet: false,
      settled: Promise.resolve(),
      undone: false,
      orphan: false,
    };
    this.taps.push(record);
    this.save(record);
    return tapOf(record);
  }

  private save(record: TapRecord, quiet = false): void {
    record.status = 'saving';
    record.quiet = quiet;
    record.settled = attempt(() => this.deps.recordStat(record.stat)).then(
      () => {
        record.status = 'saved';
        removePendingStat(record.stat.id);
        // Shown among the saved stats already (e.g. an earlier write of it landed).
        if (!record.undone && this.savedIds.has(record.stat.id)) this.drop(record);
        this.emit();
      },
      () => {
        record.status = 'failed';
        record.hasFailed = true;
        // (Unless it was taken back, or has shown up among the saved stats meanwhile.)
        if (!record.undone && this.taps.includes(record)) {
          // The journal may have been full at the tap: try to keep it now.
          record.kept ||= addPendingStat(record.stat);
          if (!record.autoRetried) {
            record.autoRetried = true;
            this.scheduleRetry();
          }
          // The app-wide retry keeps at it, even once the screen has closed.
          notifyPendingStats();
        }
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

  /**
   * Tries again to save the taps that couldn't be saved (not ones being saved or taken
   * back), and to remove taken-back taps whose removal failed. Returns those tries
   * (each settles, never rejects).
   */
  private retryTaps(quiet: boolean): Promise<unknown>[] {
    const tries: Promise<unknown>[] = [];
    for (const record of this.taps) {
      if (record.undone) {
        if (record.orphan) tries.push(this.removeOrphan(record));
      } else if (record.status === 'failed' && record.kept && !isPendingStat(record.stat.id)) {
        // No longer kept: saved meanwhile (e.g. by the app-wide retry), or its game's
        // data was deleted or replaced (e.g. in another tab). Never saved again.
        this.drop(record);
      } else if (record.status === 'failed') {
        this.save(record, quiet);
        tries.push(record.settled);
      } else if (record.status === 'saving' && record.quiet && !quiet) {
        // Retry tapped while the app-wide retry was saving it: say it's being saved.
        record.quiet = false;
        this.emit();
      }
    }
    return tries;
  }

  /** Retry (and each new tap): tries again to save the taps that couldn't be saved. */
  retry(): void {
    // Each try settles on its own and never rejects: nothing to wait for here.
    void Promise.all(this.retryTaps(false));
  }

  /**
   * The app-wide retry's go: the same, without saying so on screen (only a save that
   * lands changes anything there). Settles once the tries it started are done.
   */
  async retryQuietly(): Promise<void> {
    await Promise.all(this.retryTaps(true));
  }

  /** Whether it holds a tap not saved yet, or a taken-back one whose removal failed. */
  hasUnsaved(): boolean {
    return this.taps.some((record) => (record.undone ? record.orphan : record.status !== 'saved'));
  }

  /**
   * Its game's data was deleted or replaced (no id): every tap is forgotten, never
   * saved. With an id, that stat was deleted elsewhere: its tap, unless it's being taken
   * back here, is forgotten and never saved again.
   */
  forget(id?: string): void {
    if (id === undefined) {
      this.taps = [];
      this.removing.clear();
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    } else {
      this.taps = this.taps.filter((record) => record.undone || record.stat.id !== id);
    }
    this.emit();
  }

  /**
   * Saves every tap not saved yet (retrying those that failed), e.g. before the game
   * ends, and resolves once they've all answered (or after `waitMs`) to those still
   * not saved.
   */
  async saveAll(waitMs = SAVE_ALL_WAIT_MS): Promise<NotSaved> {
    this.retry();
    const saving = this.taps
      .filter((record) => !record.undone && record.status === 'saving')
      .map((record) => record.settled);
    if (saving.length > 0) await waitAtMost(Promise.all(saving), waitMs);
    const notSaved = this.taps.filter((record) => !record.undone && record.status !== 'saved');
    // Left for later (e.g. "End anyway"): the app-wide retry keeps trying them.
    if (notSaved.length > 0) notifyPendingStats();
    return { count: notSaved.length, kept: notSaved.every((record) => record.kept) };
  }

  /**
   * Removes a saved stat by id: 'removed', 'gone' if it wasn't there, or 'failed'.
   * Asked again while its removal is under way (e.g. the log's delete of a stat Undo is
   * removing), it's that same removal: one delete, and one outcome.
   */
  private removeStat(id: string): Promise<Removal> {
    const underWay = this.removals.get(id);
    if (underWay) return underWay;
    this.removing.add(id);
    // It stops counting at once, before the saved stats on screen catch up.
    this.emit();
    const removal = attempt(() => this.deps.deleteStat(id))
      .then(
        (event): Removal => (event ? 'removed' : 'gone'),
        (): Removal => {
          this.removing.delete(id);
          this.emit();
          return 'failed';
        },
      )
      .finally(() => this.removals.delete(id));
    this.removals.set(id, removal);
    return removal;
  }

  private removeOrphan(record: TapRecord): Promise<Removal> {
    record.orphan = false;
    return this.removeStat(record.stat.id).then((removal) => {
      if (removal === 'failed') record.orphan = true;
      else this.drop(record);
      return removal;
    });
  }

  /** Takes back a tap: at once if it isn't confirmed saved, else by removing its stat. */
  private takeBack(record: TapRecord): TakingBack {
    const { type, id } = record.stat;
    if (record.undone) {
      // Taken back already: the same outcome (and another go at removing its stat, if
      // that failed).
      if (record.orphan) record.removal = this.removeOrphan(record);
      return { type, immediate: false, removal: record.removal ?? Promise.resolve('removed') };
    }
    const confirmed = record.status === 'saved';
    record.undone = true;
    // Never saved again, even after a reload.
    removePendingStat(id);
    this.emit();
    record.removal = record.settled.then(() => this.finishTakingBack(record));
    return { type, immediate: !confirmed, removal: record.removal };
  }

  private finishTakingBack(record: TapRecord): Promise<Removal> {
    // A save of it may have landed (even one that seemed to fail): remove it by id.
    const confirmed = record.status === 'saved';
    return this.removeStat(record.stat.id).then((removal): Removal => {
      if (removal !== 'failed') {
        this.drop(record);
        return confirmed ? removal : 'removed';
      }
      if (confirmed) {
        // Its stat is saved and stays: the tap counts again.
        record.undone = false;
        record.removal = undefined;
        this.emit();
        return 'failed';
      }
      // No save of it ever landed, as far as anyone heard: it's taken back. In case one
      // did, removing it is tried again later.
      record.orphan = true;
      return 'removed';
    });
  }

  /**
   * Takes back one stat, by id: a tap from this session (the line's Undo) or a saved
   * stat (the log, or the line's Undo after a relaunch). Taking one back twice gives
   * the same outcome.
   */
  undo(stat: Pick<Tap, 'id' | 'type'>): TakingBack {
    const record = this.taps.find((each) => each.stat.id === stat.id);
    if (record) return this.takeBack(record);
    return { type: stat.type, immediate: false, removal: this.removeStat(stat.id) };
  }

  /** The most recent stat tapped before `before`: a tap that counts, or a saved stat. */
  private latest(before: number): TapRecord | StatEvent | undefined {
    let latest: TapRecord | StatEvent | undefined;
    let latestAt = -Infinity;
    const held = new Set<string>();
    for (const record of this.taps) {
      held.add(record.stat.id);
      const { at } = record.stat;
      if (!record.undone && at < before && at > latestAt) {
        latest = record;
        latestAt = at;
      }
    }
    for (const event of this.saved) {
      const at = event.createdAt;
      if (at < before && at > latestAt && !held.has(event.id) && !this.removing.has(event.id)) {
        latest = event;
        latestAt = at;
      }
    }
    return latest;
  }

  /**
   * The grid's Undo: takes back the most recent stat by tap time, a tap or a saved
   * stat. A saved stat that turns out to be gone already is skipped for the one
   * before it. A tap not confirmed saved is taken back at once; otherwise it's 'busy'
   * until the removal is done, so a double tap can't take away two stats.
   */
  undoLatest(): Promise<TakingBack | 'nothing'> | 'busy' {
    if (this.undoInFlight) return 'busy';
    const first = this.latest(Infinity);
    if (!first) return Promise.resolve('nothing');
    if (isTapRecord(first) && first.status !== 'saved') {
      // Taken back at once: the next Undo can go on to the stat before it.
      return Promise.resolve(this.takeBack(first));
    }
    this.undoInFlight = true;
    const undo = async (): Promise<TakingBack | 'nothing'> => {
      let item: TapRecord | StatEvent | undefined = first;
      while (item) {
        const taking = isTapRecord(item)
          ? this.takeBack(item)
          : { type: item.type, immediate: false, removal: this.removeStat(item.id) };
        if (taking.immediate) return taking;
        const removal = await taking.removal;
        if (removal !== 'gone') return { ...taking, removal: Promise.resolve(removal) };
        // Gone already (e.g. deleted on the report): the one before it.
        item = this.latest(isTapRecord(item) ? item.stat.at : item.createdAt);
      }
      return 'nothing';
    };
    return undo().finally(() => {
      this.undoInFlight = false;
    });
  }

  /**
   * How many stats of `type` the game has, counting the taps not saved yet: right at
   * a tap, before the saved stats on screen have caught up.
   */
  count(type: StatType): number {
    let count = 0;
    const held = new Set<string>();
    for (const record of this.taps) {
      held.add(record.stat.id);
      if (!record.undone && record.stat.type === type) count += 1;
    }
    for (const event of this.saved) {
      if (event.type === type && !held.has(event.id) && !this.removing.has(event.id)) count += 1;
    }
    return count;
  }

  /**
   * The screen is closing: the taps it saved are the database's alone (whatever reads
   * the game next reads them afresh). Taps not saved yet stay, and so do the kept ones.
   */
  forgetSaved(): void {
    this.taps = this.taps.filter((record) => record.undone || record.status !== 'saved');
    this.emit();
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
        this.savedPeriod = to;
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

/** trackingSession()'s one session per game. */
const sessions = new Map<string, TrackingSession>();
/** Undoes each trackingSession() registration: the retry's hold, and the map entry. */
const registrations = new Map<TrackingSession, () => void>();

/**
 * The session of a game, made on first use; it lasts as long as the page, holding its
 * taps not saved yet for the app-wide retry even after the screen closes, until its
 * game's data is deleted or replaced (the next screen for that game starts afresh).
 */
export function trackingSession(gameId: string, period: number): TrackingSession {
  let session = sessions.get(gameId);
  if (!session) {
    const created = new TrackingSession(gameId, period);
    const unregister = () => {
      release();
      registrations.delete(created);
      if (sessions.get(gameId) === created) sessions.delete(gameId);
    };
    const release = holdUnsavedTaps({
      gameId,
      hasUnsaved: () => created.hasUnsaved(),
      retryQuietly: () => created.retryQuietly(),
      forget: (id) => {
        created.forget(id);
        if (id === undefined) unregister();
      },
    });
    registrations.set(created, unregister);
    sessions.set(gameId, created);
    session = created;
  }
  return session;
}

/**
 * Stops every session trackingSession() holds: drops it, forgets its taps (never saving
 * them) and stops its timers, so nothing it does carries into what comes next. For the
 * test setup, after each test; a test that makes a TrackingSession itself stops it with
 * forget(). The app never needs it: a session lasts as long as the page.
 */
export function disposeTrackingSessions(): void {
  for (const [session, unregister] of [...registrations]) {
    unregister();
    session.forget();
  }
}
