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
 * - The session holds a tap only until it's among the saved stats the screen shows
 *   (syncSavedEvents): saved stats are the database's business. Undo takes back the
 *   most recent stat by tap time, a tap or a saved stat; one that turns out to be gone
 *   already is skipped, and never reported as removed.
 * - The period moves on screen at once and is then saved; the saved period takes
 *   over again once no move is being saved (or a move couldn't be saved).
 * - A 2PT/3PT tap can get its spot from a tap on the court (markSpot) for
 *   SPOT_WINDOW_MS, until the next stat, Undo or period change. The spot goes where
 *   the tap is: into its journal entry while it isn't saved (its save takes the spot
 *   along), else into its saved stat (setStatLocation), with the tap kept in the
 *   journal until that's done. Either way it ends up on the stat once, and it goes
 *   when the stat is undone.
 */
import {
  addPendingStat,
  listPendingStats,
  newPendingStat,
  removePendingStat,
  savePendingStat,
  type PendingStat,
} from '@/data/pendingStats';
import { deleteStat, setCurrentPeriod, setStatLocation } from '@/data/repo';
import { sameSpot } from '@/data/shots';
import { isFieldGoalType } from '@/data/stats';
import type { CourtPoint, StatEvent, StatType } from '@/data/types';

/** How long after a tap couldn't be saved it's tried again on its own. */
export const AUTO_RETRY_MS = 1000;

/** How long saveAll() waits for saves under way before counting them as not saved. */
export const SAVE_ALL_WAIT_MS = 3000;

/** How long after a 2PT/3PT tap a tap on the court marks where it was taken. */
export const SPOT_WINDOW_MS = 10_000;

/** The writes a session makes (the repository's, or fakes in tests). */
export interface SessionDeps {
  /**
   * Saves a tap as its stat, with its spot. Must be idempotent by the tap's id, like
   * recordStat; a stat saved already gets the tap's spot (see savePendingStat).
   */
  recordStat(stat: PendingStat): Promise<StatEvent>;
  deleteStat(eventId: string): Promise<StatEvent | undefined>;
  setCurrentPeriod(gameId: string, period: number): Promise<unknown>;
  /**
   * Puts a spot on a saved stat; resolves to undefined if the stat is gone. The
   * repository's setStatLocation if left out.
   */
  setStatLocation?(eventId: string, location: CourtPoint): Promise<StatEvent | undefined>;
}

// Looked up on each call (not captured), so tests can spy on the repository.
const repoDeps: Required<SessionDeps> = {
  recordStat: (stat) => savePendingStat(stat),
  deleteStat: (eventId) => deleteStat(eventId),
  setCurrentPeriod: (gameId, period) => setCurrentPeriod(gameId, period),
  setStatLocation: (eventId, location) => setStatLocation(eventId, location),
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
  /** Where the shot was taken, once marked on the court (2PT/3PT only). */
  readonly location?: CourtPoint;
}

/**
 * The 2PT/3PT tap whose spot a tap on the court marks (markSpot): the latest one, for
 * SPOT_WINDOW_MS, until the next stat, Undo or period change.
 */
export interface SpotShot {
  readonly tap: Tap;
  /** When (epoch ms) the court stops taking its spot. */
  readonly until: number;
  /** Where it was taken, once marked. */
  readonly spot?: CourtPoint;
}

interface TapRecord {
  /** The tap as kept in the journal: replaced (with its spot) when the spot is marked. */
  stat: PendingStat;
  /** 'saving': a save is under way. 'failed': the last one failed. 'saved': one landed. */
  status: 'saving' | 'failed' | 'saved';
  /** A save of it has failed: it's listed as not saved until one lands. */
  hasFailed: boolean;
  /** It's in the journal, so it outlives the page. */
  kept: boolean;
  /** Tried again on its own already (that happens once). */
  autoRetried: boolean;
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

/** A spot being put on a saved stat (its tap is kept in the journal, with it, until then). */
interface SpotSave {
  /** The tap as kept, with the spot wanted. */
  stat: PendingStat;
  /** A write is under way. */
  saving: boolean;
  /** The last write failed: it's tried again with the taps (see retry). */
  failed: boolean;
  /** Tried again on its own already (that happens once). */
  autoRetried: boolean;
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
  /** Some of them are being saved again right now. */
  readonly retrying: boolean;
  /** The shot whose spot a tap on the court marks now, if any (see markSpot). */
  readonly spotShot: SpotShot | null;
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
  const tap = { id: stat.id, type: stat.type, period: stat.period, at: stat.at };
  return stat.location ? { ...tap, location: stat.location } : tap;
}

function sameTaps(taps: readonly Tap[], records: readonly TapRecord[]): boolean {
  return (
    taps.length === records.length &&
    taps.every((tap, index) => {
      const stat = records[index]?.stat;
      return tap.id === stat?.id && tap.location === stat.location;
    })
  );
}

/** Whether a saved stat still lacks the spot its tap was given. */
function lacksSpot(stat: PendingStat, saved: StatEvent | undefined): boolean {
  return stat.location !== undefined && !sameSpot(saved?.location, stat.location);
}

function isTapRecord(item: TapRecord | StatEvent): item is TapRecord {
  return 'stat' in item;
}

export class TrackingSession {
  /** Taps not among the saved stats yet, and taken-back taps still being dealt with. */
  private taps: TapRecord[] = [];
  /** The game's saved stats, oldest first, as the screen last showed them. */
  private saved: readonly StatEvent[] = [];
  private savedIds = new Set<string>();
  /** Saved stats removed (or being removed) through this session, until they're gone. */
  private readonly removing = new Set<string>();
  /** The latest tap time given out or seen, so the next tap sorts after it. */
  private lastAt: number | undefined;
  private readonly listeners = new Set<() => void>();
  private period: number;
  private savedPeriod: number;
  private movesInFlight = 0;
  private undoInFlight = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private spotShot: SpotShot | null = null;
  private spotTimer: ReturnType<typeof setTimeout> | undefined;
  /** Spots being put on saved stats, by stat id. */
  private readonly spotSaves = new Map<string, SpotSave>();
  private snapshot: SessionSnapshot;
  readonly gameId: string;
  private readonly deps: SessionDeps;

  constructor(gameId: string, period: number, deps: SessionDeps = repoDeps) {
    this.gameId = gameId;
    this.deps = deps;
    this.period = period;
    this.savedPeriod = period;
    // Taps an earlier page kept but couldn't save (or didn't hear back about).
    for (const stat of listPendingStats(gameId)) {
      this.taps.push({
        stat,
        status: 'failed',
        hasFailed: true,
        kept: true,
        autoRetried: false,
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
    const retrying = unsaved.some((record) => record.status === 'saving');
    const previous = this.snapshot as SessionSnapshot | undefined;
    if (
      previous?.period === this.period &&
      previous.unsavedKept === unsavedKept &&
      previous.retrying === retrying &&
      previous.spotShot === this.spotShot &&
      sameTaps(previous.pending, pending) &&
      sameTaps(previous.unsaved, unsaved)
    ) {
      return previous;
    }
    return {
      period: this.period,
      pending: pending.map(tapOf),
      unsaved: unsaved.map(tapOf),
      unsavedKept,
      retrying,
      spotShot: this.spotShot,
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
    const savedById = new Map(events.map((event) => [event.id, event]));
    this.savedIds = new Set(savedById.keys());
    const newest = events.at(-1)?.createdAt;
    if (newest !== undefined) this.lastAt = Math.max(this.lastAt ?? newest, newest);
    for (const id of this.removing) {
      if (!this.savedIds.has(id)) this.removing.delete(id);
    }
    for (const record of this.taps) {
      const saved = savedById.get(record.stat.id);
      if (!saved) continue;
      if (!record.undone) {
        // Saved, whatever its own write said: nothing left to keep, unless it still
        // needs the spot marked after that write started.
        if (lacksSpot(record.stat, saved)) this.saveSpot(record.stat);
        else this.forgetKept(record.stat.id);
      } else if (record.orphan) {
        // A tap taken back whose save landed after all: remove it again.
        void this.removeOrphan(record);
      }
    }
    // Spots on their stats already (e.g. a write that seemed to fail landed).
    for (const [id, spotSave] of this.spotSaves) {
      const saved = savedById.get(id);
      if (saved && !spotSave.saving && !lacksSpot(spotSave.stat, saved)) {
        this.spotSaves.delete(id);
        removePendingStat(id);
      }
    }
    this.taps = this.taps.filter((record) => record.undone || !this.savedIds.has(record.stat.id));
    this.emit();
  }

  /** Forgets a saved tap's journal entry, unless it's kept until its spot is saved. */
  private forgetKept(id: string): void {
    if (!this.spotSaves.has(id)) removePendingStat(id);
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
      settled: Promise.resolve(),
      undone: false,
      orphan: false,
    };
    this.taps.push(record);
    // A shot's spot can be marked next; any other stat ends the last shot's chance.
    this.setSpotShot(
      isFieldGoalType(type) ? { tap: tapOf(record), until: Date.now() + SPOT_WINDOW_MS } : null,
    );
    this.save(record);
    return tapOf(record);
  }

  private save(record: TapRecord): void {
    record.status = 'saving';
    record.settled = attempt(() => this.deps.recordStat(record.stat)).then(
      (saved: StatEvent | undefined) => {
        record.status = 'saved';
        // Its spot was marked while this write was under way (or an earlier write saved
        // it without one): the spot is saved next, and the tap kept until then.
        if (!record.undone && lacksSpot(record.stat, saved)) this.saveSpot(record.stat);
        else this.forgetKept(record.stat.id);
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
   * back) and the spots that couldn't be put on saved stats, and to remove taken-back
   * taps whose removal failed.
   */
  retry(): void {
    for (const record of this.taps) {
      if (record.undone) {
        if (record.orphan) void this.removeOrphan(record);
      } else if (record.status === 'failed') {
        this.save(record);
      }
    }
    for (const [id, spotSave] of this.spotSaves) {
      if (spotSave.failed) this.startSpotSave(id);
    }
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
    if (saving.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(saving),
        new Promise((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
      clearTimeout(timer);
    }
    const notSaved = this.taps.filter((record) => !record.undone && record.status !== 'saved');
    return { count: notSaved.length, kept: notSaved.every((record) => record.kept) };
  }

  /** Removes a saved stat by id: 'removed', 'gone' if it wasn't there, or 'failed'. */
  private removeStat(id: string): Promise<Removal> {
    this.removing.add(id);
    // Its spot goes with it: never saved, and never kept to be saved after a reload.
    this.spotSaves.delete(id);
    removePendingStat(id);
    return attempt(() => this.deps.deleteStat(id)).then(
      (event): Removal => (event ? 'removed' : 'gone'),
      (): Removal => {
        this.removing.delete(id);
        return 'failed';
      },
    );
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
    // Never saved again, even after a reload; nor is its spot.
    removePendingStat(id);
    this.spotSaves.delete(id);
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
    this.closeSpot();
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
    this.closeSpot();
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

  /** Opens the court to `shot`'s spot until its time is up, or closes it (null). */
  private setSpotShot(shot: SpotShot | null): void {
    clearTimeout(this.spotTimer);
    this.spotTimer = undefined;
    this.spotShot = shot;
    if (!shot) return;
    this.spotTimer = setTimeout(
      () => {
        this.spotTimer = undefined;
        if (this.spotShot?.tap.id !== shot.tap.id) return;
        this.spotShot = null;
        this.emit();
      },
      Math.max(0, shot.until - Date.now()),
    );
  }

  /** The shot whose spot the court marks now, if its time isn't up (the timer may be late). */
  private openSpotShot(): SpotShot | null {
    if (this.spotShot && Date.now() >= this.spotShot.until) this.closeSpot();
    return this.spotShot;
  }

  /** From now on a tap on the court marks no spot, until the next 2PT/3PT tap. */
  closeSpot(): void {
    if (!this.spotShot) return;
    this.setSpotShot(null);
    this.emit();
  }

  /**
   * A tap on the court: marks where the shot in `spotShot` was taken, or moves its spot,
   * and saves the spot with the shot's stat, whether that's saved yet or not. False if
   * no shot's spot can be marked now (then nothing changes).
   */
  markSpot(point: CourtPoint): boolean {
    const shot = this.openSpotShot();
    if (!shot) return false;
    const { id, type, period, at } = shot.tap;
    const record = this.taps.find((each) => each.stat.id === id);
    // (Undo closes the court, so a shot taken back never gets here.)
    if (record?.undone) return false;
    const stat: PendingStat = {
      ...(record?.stat ?? { id, gameId: this.gameId, type, period, at }),
      location: point,
    };
    this.spotShot = { ...shot, spot: point };
    if (record) record.stat = stat;
    if (record && record.status !== 'saved') {
      // Not saved yet: its journal entry takes the spot, and so does its next save. (A
      // save already under way puts the spot on once it lands; see save.)
      record.kept = addPendingStat(stat) || record.kept;
    } else {
      this.saveSpot(stat);
    }
    this.emit();
    return true;
  }

  /**
   * Puts a tap's spot on its saved stat. The tap is kept in the journal, with its spot,
   * until that's done: a page that closes first leaves it to replayPendingStats.
   */
  private saveSpot(stat: PendingStat): void {
    addPendingStat(stat);
    const spotSave = this.spotSaves.get(stat.id);
    if (spotSave) spotSave.stat = stat;
    else this.spotSaves.set(stat.id, { stat, saving: false, failed: false, autoRetried: false });
    this.startSpotSave(stat.id);
  }

  private startSpotSave(id: string): void {
    const spotSave = this.spotSaves.get(id);
    const spot = spotSave?.stat.location;
    if (!spotSave || spotSave.saving || !spot) return;
    spotSave.saving = true;
    spotSave.failed = false;
    const write = () =>
      this.deps.setStatLocation
        ? this.deps.setStatLocation(id, spot)
        : repoDeps.setStatLocation(id, spot);
    void attempt(write).then(
      (saved) => {
        spotSave.saving = false;
        // Its stat was taken back meanwhile: nothing left to do.
        if (this.spotSaves.get(id) !== spotSave) return;
        // Moved meanwhile: the new spot next.
        if (saved && !sameSpot(spot, spotSave.stat.location)) {
          this.startSpotSave(id);
          return;
        }
        // On its stat (or the stat is gone, e.g. deleted on another screen): done.
        this.spotSaves.delete(id);
        removePendingStat(id);
      },
      () => {
        spotSave.saving = false;
        if (this.spotSaves.get(id) !== spotSave) return;
        spotSave.failed = true;
        if (!spotSave.autoRetried) {
          spotSave.autoRetried = true;
          this.scheduleRetry();
        }
      },
    );
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
    this.setSpotShot(null);
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
