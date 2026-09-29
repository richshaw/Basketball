import { afterEach, describe, expect, it, vi } from 'vitest';
import { addPendingSpot, listPendingSpots } from '@/data/pendingSpots';
import {
  listPendingStats,
  replayPendingStats,
  savePendingStat,
  type PendingStat,
} from '@/data/pendingStats';
import * as repo from '@/data/repo';
import { createGame, deleteStat, getGameEvents, setCurrentPeriod } from '@/data/repo';
import type { CourtPoint, StatEvent, StatType } from '@/data/types';
import {
  AUTO_RETRY_MS,
  disposeTrackingSessions,
  SPOT_WINDOW_MS,
  trackingSession,
  TrackingSession,
  type SessionDeps,
  type TakingBack,
} from './session';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The ids of the taps kept in the pending-stats journal. */
const keptIds = () => listPendingStats().map((stat) => stat.id);

/**
 * A fake database: each save waits until the test answers it (`save`/`fail`), so
 * every interleaving of taps and answers can be played out exactly. Like the real
 * one, it saves a tap once however often it's asked to (by the tap's id).
 */
function fakeDeps() {
  // `kept`: the tap was in the pending-stats journal when its save started.
  const saves: { stat: PendingStat; kept: boolean; answer: Deferred<StatEvent> }[] = [];
  const deletes: string[] = [];
  const moves: { period: number; answer: Deferred<unknown> }[] = [];
  // Spots put on saved stats, in call order; each waits for the test too (`saveSpot`).
  const spots: { id: string; location: CourtPoint; answer: Deferred<StatEvent | undefined> }[] = [];
  let stored: StatEvent[] = [];
  let failDeletes = false;

  const deps: SessionDeps = {
    recordStat: (stat) => {
      const answer = deferred<StatEvent>();
      saves.push({ stat, kept: keptIds().includes(stat.id), answer });
      return answer.promise;
    },
    deleteStat: (eventId) => {
      deletes.push(eventId);
      if (failDeletes) return Promise.reject(new Error('Disk error'));
      const event = stored.find((each) => each.id === eventId);
      stored = stored.filter((each) => each !== event);
      return Promise.resolve(event);
    },
    setCurrentPeriod: (_gameId, period) => {
      const answer = deferred<unknown>();
      moves.push({ period, answer });
      return answer.promise;
    },
    setStatLocation: (eventId, location) => {
      const answer = deferred<StatEvent | undefined>();
      spots.push({ id: eventId, location, answer });
      return answer.promise;
    },
  };

  /**
   * Stores save number `index`'s stat (once per id: like recordStat, a stat stored
   * already stays as it is, spot and all), without answering it.
   */
  const land = (index: number): StatEvent => {
    const call = saves[index];
    if (!call) throw new Error(`No save #${index}`);
    const { id, type, period, at, location } = call.stat;
    let event = stored.find((each) => each.id === id);
    if (!event) {
      event = { id, gameId: 'g', type, period, createdAt: at, ...(location ? { location } : {}) };
      stored = [...stored, event].sort((a, b) => a.createdAt - b.createdAt);
    }
    return event;
  };
  /** Answers spot write number `index`: puts its spot on the stored stat, if it's there. */
  const saveSpot = (index: number): StatEvent | undefined => {
    const call = spots[index];
    if (!call) throw new Error(`No spot write #${index}`);
    const event = stored.find((each) => each.id === call.id);
    const updated = event && { ...event, location: call.location };
    if (updated) stored = stored.map((each) => (each === event ? updated : each));
    call.answer.resolve(updated);
    return updated;
  };
  const failSpot = (index: number) => spots[index]?.answer.reject(new Error('Disk error'));
  /** Answers save number `index` (0-based, in call order) with its stored stat. */
  const save = (index: number): StatEvent => {
    const event = land(index);
    saves[index]?.answer.resolve(event);
    return event;
  };
  const fail = (index: number) => saves[index]?.answer.reject(new Error('Disk error'));

  return {
    deps,
    saves,
    deletes,
    moves,
    spots,
    saveSpot,
    failSpot,
    /** The saved stats, oldest first (as the screen reads them). */
    stored: () => stored,
    store: (...events: StatEvent[]) => {
      stored = [...stored, ...events].sort((a, b) => a.createdAt - b.createdAt);
    },
    /** Deletes a stat elsewhere (another screen or tab). */
    deleteElsewhere: (id: string) => {
      stored = stored.filter((each) => each.id !== id);
    },
    land,
    save,
    fail,
    failDeletes: (value: boolean) => {
      failDeletes = value;
    },
    storedTypes: () => stored.map((event) => event.type),
  };
}

function setUp(period = 1) {
  const fake = fakeDeps();
  const session = new TrackingSession('g', period, fake.deps);
  const unsavedTypes = () => session.getSnapshot().unsaved.map((tap) => tap.type);
  const pendingTypes = () => session.getSnapshot().pending.map((tap) => tap.type);
  /** Shows the session the saved stats, as the screen does whenever they change. */
  const sync = () => session.syncSavedEvents(fake.stored());
  return { ...fake, session, unsavedTypes, pendingTypes, sync };
}

/** What an Undo ended up doing: [type, how its removal went]. */
async function outcome(taking: TakingBack | 'nothing' | 'busy' | Promise<TakingBack | 'nothing'>) {
  const result = await taking;
  if (result === 'nothing' || result === 'busy') return result;
  return [result.type, await result.removal];
}

function event(id: string, type: StatType, createdAt: number): StatEvent {
  return { id, gameId: 'g', type, period: 1, createdAt };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TrackingSession', () => {
  it('saves each tap at once, in the period on screen, under an id and tap time made at the tap', async () => {
    const { session, saves, save, moves, storedTypes } = setUp(3);
    const steal = session.record('stl');
    void session.movePeriod(4);
    // Tapped before the move is saved: still in the period on screen, Q4.
    const assist = session.record('ast');
    expect(assist.period).toBe(4);
    expect(saves.map(({ stat }) => [stat.id, stat.type, stat.period, stat.at])).toEqual([
      [steal.id, 'stl', 3, steal.at],
      [assist.id, 'ast', 4, assist.at],
    ]);
    expect(assist.at).toBeGreaterThan(steal.at);
    expect(moves.map((move) => move.period)).toEqual([4]);
    // Kept on the phone from the moment of the tap (before its save starts), until saved.
    expect(saves.map((call) => call.kept)).toEqual([true, true]);
    expect(keptIds()).toEqual([steal.id, assist.id]);
    save(0);
    save(1);
    await flush();
    expect(storedTypes()).toEqual(['stl', 'ast']);
    expect(keptIds()).toEqual([]);
  });

  it('gives each tap a time after the saved stats and taps before it, even if the clock goes back', () => {
    const { session, store, sync } = setUp();
    const later = Date.now() + 60_000;
    store(event('saved', 'dreb', later));
    sync();
    const first = session.record('stl');
    const second = session.record('ast');
    expect(first.at).toBe(later + 1);
    expect(second.at).toBe(later + 2);
  });

  it('keeps a tap that failed through later taps, and saves it first on the next tap', async () => {
    const { session, saves, save, fail, unsavedTypes, storedTypes } = setUp(2);
    const steal = session.record('stl');
    fail(0);
    await flush();
    expect(unsavedTypes()).toEqual(['stl']);
    expect(session.getSnapshot().unsavedKept).toBe(true);
    expect(keptIds()).toEqual([steal.id]);

    // The next tap retries the Steal first, the same tap in its own period, then saves itself.
    void session.movePeriod(3);
    session.record('ast');
    expect(saves.map(({ stat }) => [stat.type, stat.period])).toEqual([
      ['stl', 2],
      ['stl', 2],
      ['ast', 3],
    ]);
    expect(saves[1]?.stat).toEqual(saves[0]?.stat);
    expect(session.getSnapshot().retrying).toBe(true);
    expect(unsavedTypes()).toEqual(['stl']);
    save(1);
    save(2);
    await flush();
    expect(unsavedTypes()).toEqual([]);
    expect(storedTypes()).toEqual(['stl', 'ast']);
    expect(keptIds()).toEqual([]);
  });

  it('retries a failed tap on its own once, then waits for a tap, the page or Retry', async () => {
    vi.useFakeTimers();
    const { session, saves, save, fail, unsavedTypes } = setUp();
    session.record('blk');
    fail(0);
    await vi.advanceTimersByTimeAsync(AUTO_RETRY_MS - 1);
    expect(saves).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(saves).toHaveLength(2);

    // The automatic retry fails too: no more retries on a timer.
    fail(1);
    await vi.advanceTimersByTimeAsync(10 * AUTO_RETRY_MS);
    expect(saves).toHaveLength(2);
    expect(unsavedTypes()).toEqual(['blk']);

    session.retry();
    expect(saves).toHaveLength(3);
    session.retry(); // Already being saved: not saved twice.
    expect(saves).toHaveLength(3);
    save(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(unsavedTypes()).toEqual([]);
  });

  it('saves a tap once when its write lands but the page hears it failed', async () => {
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    // Like WebKit losing its IndexedDB connection: the write commits, then rejects.
    let lies = 1;
    const session = new TrackingSession(game.id, 1, {
      recordStat: async (stat) => {
        const saved = await savePendingStat(stat);
        if (lies-- > 0)
          throw new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
        return saved;
      },
      deleteStat,
      setCurrentPeriod,
    });
    const steal = session.record('stl');
    await vi.waitFor(() => expect(session.getSnapshot().unsaved).toEqual([steal]));

    session.retry();
    await vi.waitFor(() => expect(session.getSnapshot().unsaved).toEqual([]));
    expect((await getGameEvents(game.id)).map((each) => [each.id, each.type])).toEqual([
      [steal.id, 'stl'],
    ]);
    expect(keptIds()).toEqual([]);
  });

  it('is kept across a reload: a new session shows the tap and saves it, once', async () => {
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const broken: SessionDeps = {
      recordStat: () => Promise.reject(new DOMException('Connection lost.', 'UnknownError')),
      deleteStat,
      setCurrentPeriod,
    };
    const before = new TrackingSession(game.id, 2, broken);
    const block = before.record('blk');
    await vi.waitFor(() => expect(before.getSnapshot().unsaved).toEqual([block]));
    expect(keptIds()).toEqual([block.id]);

    // The page reloads: memory is gone, the journal isn't. The new session lists the
    // tap as not saved (so it's counted, can be undone, and says so) and saves it.
    const after = new TrackingSession(game.id, 2);
    expect(after.getSnapshot()).toMatchObject({
      pending: [block],
      unsaved: [block],
      unsavedKept: true,
    });
    after.retry();
    await vi.waitFor(() => expect(after.getSnapshot().unsaved).toEqual([]));
    expect(await getGameEvents(game.id)).toEqual([
      { id: block.id, gameId: game.id, type: 'blk', period: 2, createdAt: block.at },
    ]);
    expect(keptIds()).toEqual([]);
    after.retry();
    await flush();
    expect(await getGameEvents(game.id)).toHaveLength(1);
  });

  it("starts with its own game's kept taps only", () => {
    const { session } = setUp();
    const other = new TrackingSession('other', 1, fakeDeps().deps);
    const tap = other.record('ast');
    expect(new TrackingSession('g', 1, fakeDeps().deps).getSnapshot().pending).toEqual([]);
    expect(new TrackingSession('other', 1, fakeDeps().deps).getSnapshot().pending).toEqual([tap]);
    expect(session.getSnapshot().pending).toEqual([]);
  });

  it("keeps saving without the journal, and says a tap it couldn't save isn't kept", async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const { session, save, fail, unsavedTypes, storedTypes } = setUp();
    session.record('stl');
    session.record('ast');
    save(0);
    fail(1);
    await flush();
    expect(storedTypes()).toEqual(['stl']);
    expect(unsavedTypes()).toEqual(['ast']);
    expect(session.getSnapshot().unsavedKept).toBe(false);
  });

  it('never retries a tap that was undone, even if its save fails after the Undo', async () => {
    vi.useFakeTimers();
    const { session, saves, fail, unsavedTypes, storedTypes } = setUp();
    const steal = session.record('stl');
    const taking = session.undo(steal);
    expect(taking.immediate).toBe(true);
    expect(keptIds()).toEqual([]);
    fail(0);
    expect(await taking.removal).toBe('removed');
    expect(unsavedTypes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5 * AUTO_RETRY_MS);
    session.record('ast');
    expect(saves.map(({ stat }) => stat.type)).toEqual(['stl', 'ast']);
    expect(storedTypes()).toEqual([]);

    // Undone after it failed: dropped, and not retried by the next tap either.
    const block = session.record('blk');
    fail(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(unsavedTypes()).toEqual(['blk']);
    expect(await session.undo(block).removal).toBe('removed');
    expect(unsavedTypes()).toEqual([]);
    session.retry();
    expect(saves.map(({ stat }) => stat.type)).toEqual(['stl', 'ast', 'blk']);
  });

  it('removes an undone tap once its save lands, and only once', async () => {
    const { session, save, deletes, storedTypes } = setUp();
    const tap = session.record('fg3_made');
    const first = session.undo(tap);
    const second = session.undo(tap);
    const saved = save(0);
    expect(await first.removal).toBe('removed');
    expect(await second.removal).toBe('removed');
    expect(deletes).toEqual([saved.id]);
    expect(storedTypes()).toEqual([]);
  });

  it('also removes an undone tap whose save seemed to fail but landed', async () => {
    const { session, land, fail, deletes, storedTypes } = setUp();
    const tap = session.record('ast');
    land(0);
    fail(0);
    await flush();
    expect(await session.undo(tap).removal).toBe('removed');
    expect(deletes).toEqual([tap.id]);
    expect(storedTypes()).toEqual([]);
  });

  it('counts a tap again if its stat could not be removed', async () => {
    const { session, save, sync, failDeletes, storedTypes, pendingTypes } = setUp();
    const tap = session.record('foul');
    save(0);
    await flush();
    failDeletes(true);
    const taking = session.undo(tap);
    // Saved already: it only goes once its removal is done.
    expect(taking.immediate).toBe(false);
    expect(await taking.removal).toBe('failed');
    expect(pendingTypes()).toEqual(['foul']);
    expect(storedTypes()).toEqual(['foul']);
    sync();
    failDeletes(false);
    expect(await outcome(session.undoLatest())).toEqual(['foul', 'removed']);
    expect(storedTypes()).toEqual([]);
  });

  describe('undoLatest (the grid Undo)', () => {
    const before = [event('old1', 'dreb', 1), event('old2', 'ast', 2)];

    it('takes back the latest stat by tap time: taps at once, saved stats once removed', async () => {
      const { session, save, fail, store, sync, deletes, stored, unsavedTypes } = setUp();
      store(...before);
      sync();
      const steal = session.record('stl');
      const block = session.record('blk');
      save(0);
      fail(1);
      await flush();
      sync();
      expect(unsavedTypes()).toEqual(['blk']);

      // The Block was never saved: taken back at once.
      expect(await outcome(session.undoLatest())).toEqual(['blk', 'removed']);
      expect(unsavedTypes()).toEqual([]);

      const removingSteal = session.undoLatest();
      // A second Undo while the first is still removing its stat is ignored.
      expect(session.undoLatest()).toBe('busy');
      expect(await outcome(removingSteal)).toEqual(['stl', 'removed']);
      sync();

      // Then the stats from before this session, newest first, by id.
      expect(await outcome(session.undoLatest())).toEqual(['ast', 'removed']);
      // Even if the list on screen hasn't caught up yet, the Assist isn't counted twice.
      expect(await outcome(session.undoLatest())).toEqual(['dreb', 'removed']);
      expect(await outcome(session.undoLatest())).toBe('nothing');
      // (The Block by id too, in case a save of it landed after all.)
      expect(deletes).toEqual([block.id, steal.id, 'old2', 'old1']);
      expect(stored()).toEqual([]);
    });

    it('takes back a tap still being saved, removing it once saved', async () => {
      const { session, save, store, sync, deletes, stored } = setUp();
      store(...before);
      sync();
      const steal = session.record('stl');
      const taking = session.undoLatest();
      // Not busy: the next Undo already goes to the stat before it.
      const assist = session.undoLatest();
      save(0);
      expect(await outcome(taking)).toEqual(['stl', 'removed']);
      expect(await outcome(assist)).toEqual(['ast', 'removed']);
      expect(deletes).toEqual(['old2', steal.id]);
      expect(stored().map((each) => each.id)).toEqual(['old1']);
    });

    it('takes back a tap saved a moment ago, before the saved stats on screen show it', async () => {
      const { session, save, store, sync, stored } = setUp();
      store(...before);
      sync();
      session.record('stl');
      save(0);
      await flush();
      // Not synced: the screen still shows the stats from before.
      expect(await outcome(session.undoLatest())).toEqual(['stl', 'removed']);
      expect(stored().map((each) => each.id)).toEqual(['old1', 'old2']);
    });

    it('skips a saved stat that is gone already, and never says it removed it', async () => {
      const { session, store, sync, deleteElsewhere, deletes, stored } = setUp();
      store(event('steal', 'stl', 10), event('block', 'blk', 20));
      sync();
      // Deleted on another screen (or in another tab); this screen hasn't caught up.
      deleteElsewhere('block');
      expect(await outcome(session.undoLatest())).toEqual(['stl', 'removed']);
      expect(deletes).toEqual(['block', 'steal']);
      expect(stored()).toEqual([]);
      sync();
      expect(await outcome(session.undoLatest())).toBe('nothing');
    });

    it('goes by the saved stats after the screen closes and opens again', async () => {
      // Steal, Block, End game; Block is deleted on the report; "Add or fix stats"; Undo.
      const { session, save, sync, deleteElsewhere, deletes, stored } = setUp();
      session.record('stl');
      const block = session.record('blk');
      save(0);
      save(1);
      await flush();
      session.forgetSaved();
      deleteElsewhere(block.id);
      sync();
      expect(session.getSnapshot().pending).toEqual([]);
      expect(await outcome(session.undoLatest())).toEqual(['stl', 'removed']);
      expect(deletes).toHaveLength(1);
      expect(stored()).toEqual([]);
    });

    it('says a stat it was asked to take back by id was gone already', async () => {
      const { session, store, sync, deleteElsewhere } = setUp();
      const steal = event('steal', 'stl', 10);
      store(steal);
      sync();
      deleteElsewhere('steal');
      const taking = session.undo(steal);
      expect(taking.immediate).toBe(false);
      expect(await taking.removal).toBe('gone');
    });
  });

  describe('counting', () => {
    it('counts saved stats and taps not saved yet, each once', async () => {
      const { session, store, sync, save, fail } = setUp();
      store(event('f1', 'foul', 1), event('f2', 'foul', 2), event('f3', 'foul', 3));
      sync();
      // Two quick fouls, before anything is saved or shown.
      session.record('foul');
      expect(session.count('foul')).toBe(4);
      session.record('foul');
      expect(session.count('foul')).toBe(5);
      save(0);
      fail(1);
      await flush();
      expect(session.count('foul')).toBe(5);
      sync();
      expect(session.count('foul')).toBe(5);
      expect(session.getSnapshot().pending.map((tap) => tap.type)).toEqual(['foul']);
      expect(session.count('stl')).toBe(0);
    });

    it('stops counting a stat once it is being removed', async () => {
      const { session, store, sync } = setUp();
      store(event('f1', 'foul', 1), event('f2', 'foul', 2));
      sync();
      const removal = session.undoLatest();
      expect(session.count('foul')).toBe(1);
      await outcome(removal);
      expect(session.count('foul')).toBe(1);
    });
  });

  describe('saveAll (before the game ends)', () => {
    it('tries the unsaved taps again, waits for every save, and says what still is not saved', async () => {
      const { session, saves, save, fail } = setUp();
      session.record('stl');
      fail(0);
      await flush();
      session.record('ast'); // (Retries the Steal first: save #1.)
      const result = session.saveAll();
      expect(saves.map(({ stat }) => stat.type)).toEqual(['stl', 'stl', 'ast']);
      fail(1);
      save(2);
      expect(await result).toEqual({ count: 1, kept: true });

      const again = session.saveAll();
      save(3);
      expect(await again).toEqual({ count: 0, kept: true });
    });

    it("doesn't wait forever for a save that never answers", async () => {
      const { session } = setUp();
      session.record('stl');
      expect(await session.saveAll(20)).toEqual({ count: 1, kept: true });
    });

    it('leaves out a tap that was undone', async () => {
      const { session, fail } = setUp();
      const steal = session.record('stl');
      fail(0);
      await flush();
      await session.undo(steal).removal;
      expect(await session.saveAll()).toEqual({ count: 0, kept: true });
    });
  });

  describe('period', () => {
    it('shows a move at once, keeps it while it saves, and follows the saved period', async () => {
      const { session, moves } = setUp(1);
      const moved = session.movePeriod(2);
      expect(session.getSnapshot().period).toBe(2);
      // A saved period arriving meanwhile (e.g. from an earlier write) is ignored...
      session.syncSavedPeriod(1);
      expect(session.getSnapshot().period).toBe(2);
      moves[0]?.answer.resolve(undefined);
      expect(await moved).toBe(true);
      session.syncSavedPeriod(2);
      expect(session.getSnapshot().period).toBe(2);
      // ...but once nothing is moving, the saved period (e.g. changed elsewhere) shows.
      session.syncSavedPeriod(4);
      expect(session.getSnapshot().period).toBe(4);
    });

    it('goes back to the saved period if a move could not be saved', async () => {
      const { session, moves } = setUp(3);
      const moved = session.movePeriod(4);
      moves[0]?.answer.reject(new Error('Disk error'));
      expect(await moved).toBe(false);
      expect(session.getSnapshot().period).toBe(3);
    });

    it('goes back to the last move that was saved, even before the saved game shows it', async () => {
      const { session, moves } = setUp(1);
      const saved = session.movePeriod(2);
      moves[0]?.answer.resolve(undefined);
      expect(await saved).toBe(true);
      // The saved game hasn't come back with Q2 yet when the next move fails.
      const failed = session.movePeriod(3);
      moves[1]?.answer.reject(new Error('Disk error'));
      expect(await failed).toBe(false);
      expect(session.getSnapshot().period).toBe(2);
    });

    it('keeps a later move when an earlier one fails', async () => {
      const { session, moves } = setUp(1);
      const first = session.movePeriod(2);
      const second = session.movePeriod(3);
      moves[0]?.answer.reject(new Error('Disk error'));
      expect(await first).toBe(false);
      expect(session.getSnapshot().period).toBe(3);
      moves[1]?.answer.resolve(undefined);
      expect(await second).toBe(true);
      expect(session.getSnapshot().period).toBe(3);
    });
  });

  it('tells subscribers only when something on screen changes', async () => {
    const { session, save, fail, sync } = setUp();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    const snapshot = session.getSnapshot();
    session.record('ast');
    expect(listener).toHaveBeenCalledTimes(1);
    save(0);
    await flush();
    // Saved, but the screen doesn't show it among the saved stats yet: nothing to redraw.
    expect(listener).toHaveBeenCalledTimes(1);
    sync();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(session.getSnapshot()).toEqual(snapshot);
    sync();
    expect(listener).toHaveBeenCalledTimes(2);

    session.record('stl');
    fail(1);
    await flush();
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
    void session.movePeriod(2);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});

describe('TrackingSession spots (the shot chart)', () => {
  // Where shots were taken, in feet from the basket.
  const ELBOW: CourtPoint = { x: -6, y: 13.75 };
  const CORNER: CourtPoint = { x: 23, y: -3 };
  const LAYUP: CourtPoint = { x: 1, y: 2 };

  /** The taps kept on the phone (src/data/pendingStats.ts), with their spots. */
  const keptTaps = () => listPendingStats().map((stat) => [stat.id, stat.location]);
  /** The spots kept for saved stats (src/data/pendingSpots.ts). */
  const keptSpots = () => listPendingSpots().map((spot) => [spot.id, spot.location]);

  it("opens the court to a 2PT/3PT tap's spot until the next stat, never to a free throw's", async () => {
    const { session, saves, spots } = setUp();
    const spotShot = () => session.getSnapshot().spotShot;
    const shot = session.record('fg2_made');
    expect(spotShot()).toMatchObject({ tap: shot });
    expect(spotShot()?.spot).toBeUndefined();

    // Free throws never take a spot: a free throw closes the court, and a tap on it
    // then marks nothing.
    session.record('ft_made');
    expect(spotShot()).toBeNull();
    expect(session.markSpot(ELBOW)).toBe(false);

    const three = session.record('fg3_miss');
    expect(spotShot()).toMatchObject({ tap: three });
    session.record('dreb');
    expect(spotShot()).toBeNull();
    expect(session.markSpot(CORNER)).toBe(false);

    await flush();
    expect(saves.map(({ stat }) => stat.location)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(spots).toEqual([]);
    expect(keptTaps().every(([, spot]) => spot === undefined)).toBe(true);
    expect(keptSpots()).toEqual([]);
  });

  it('keeps the spot of a shot not saved yet with the tap, and saves them together, once', async () => {
    const { session, saves, save, fail, stored, spots, pendingTypes } = setUp();
    const shot = session.record('fg2_made');
    fail(0);
    await flush();
    expect(session.getSnapshot().unsaved).toEqual([shot]);

    expect(session.markSpot(ELBOW)).toBe(true);
    expect(session.getSnapshot().spotShot?.spot).toEqual(ELBOW);
    // In the tap's journal entry at once, so a reload saves it with the tap.
    expect(keptTaps()).toEqual([[shot.id, ELBOW]]);
    expect(keptSpots()).toEqual([]);
    // Counted as the same tap, now with its spot.
    expect(session.getSnapshot().pending).toEqual([{ ...shot, location: ELBOW }]);
    expect(pendingTypes()).toEqual(['fg2_made']);

    session.retry();
    expect(saves[1]?.stat).toEqual({ ...saves[0]?.stat, location: ELBOW });
    save(1);
    await flush();
    expect(stored()).toEqual([
      {
        id: shot.id,
        gameId: 'g',
        type: 'fg2_made',
        period: 1,
        createdAt: shot.at,
        location: ELBOW,
      },
    ]);
    // Saved with the tap: no separate write, and nothing left to keep.
    expect(spots).toEqual([]);
    expect(keptTaps()).toEqual([]);
    expect(keptSpots()).toEqual([]);
  });

  it('puts the spot of a saved shot on its stat, keeping the spot (never the tap) until then', async () => {
    const { session, save, sync, stored, spots, saveSpot } = setUp();
    const shot = session.record('fg3_made');
    save(0);
    await flush();
    sync();
    expect(keptTaps()).toEqual([]);

    expect(session.markSpot(CORNER)).toBe(true);
    expect(spots.map(({ id, location }) => [id, location])).toEqual([[shot.id, CORNER]]);
    // Kept until it's saved, in case the page closes first: as a spot, which never
    // brings back its stat (a kept tap is saved again, even if its stat was deleted).
    expect(keptSpots()).toEqual([[shot.id, CORNER]]);
    expect(keptTaps()).toEqual([]);
    expect(session.getSnapshot().unsaved).toEqual([]);

    saveSpot(0);
    await flush();
    expect(stored().map((event) => [event.id, event.location])).toEqual([[shot.id, CORNER]]);
    expect(keptSpots()).toEqual([]);
  });

  it("puts a spot marked while its shot's save is under way on the stat once it lands", async () => {
    const { session, saves, save, stored, spots, saveSpot } = setUp();
    const shot = session.record('fg2_miss');
    // The save under way started before the spot: it saves the shot without it.
    expect(session.markSpot(ELBOW)).toBe(true);
    expect(keptTaps()).toEqual([[shot.id, ELBOW]]);
    save(0);
    await flush();
    expect(stored().map((event) => event.location)).toEqual([undefined]);
    // So the spot is put on it next: the tap is saved, and only its spot is kept now.
    expect(spots.map(({ id, location }) => [id, location])).toEqual([[shot.id, ELBOW]]);
    expect(keptTaps()).toEqual([]);
    expect(keptSpots()).toEqual([[shot.id, ELBOW]]);

    saveSpot(0);
    await flush();
    expect(stored().map((event) => [event.id, event.location])).toEqual([[shot.id, ELBOW]]);
    expect(saves).toHaveLength(1);
    expect(keptSpots()).toEqual([]);
  });

  it('gives a shot whose failed save landed after all its spot, once', async () => {
    const { session, saves, land, fail, save, stored, spots, saveSpot } = setUp();
    const shot = session.record('fg2_made');
    // The write lands without a spot, but the page hears it failed.
    land(0);
    fail(0);
    await flush();
    expect(session.markSpot(LAYUP)).toBe(true);
    expect(keptTaps()).toEqual([[shot.id, LAYUP]]);

    // The retry takes the spot along, but finds the stat saved already, as it was.
    session.retry();
    expect(saves[1]?.stat.location).toEqual(LAYUP);
    save(1);
    await flush();
    expect(spots.map(({ id, location }) => [id, location])).toEqual([[shot.id, LAYUP]]);
    expect(keptTaps()).toEqual([]);
    expect(keptSpots()).toEqual([[shot.id, LAYUP]]);
    saveSpot(0);
    await flush();
    expect(stored().map((event) => [event.id, event.type, event.location])).toEqual([
      [shot.id, 'fg2_made', LAYUP],
    ]);
    expect(keptSpots()).toEqual([]);
  });

  it('moves the spot with another tap, and saves the last one', async () => {
    const { session, save, sync, stored, spots, saveSpot } = setUp();
    // While its save is under way, the journal takes each spot in turn, and the last
    // one is put on the stat once the save lands.
    const first = session.record('fg2_made');
    session.markSpot(ELBOW);
    session.markSpot(LAYUP);
    expect(session.getSnapshot().spotShot?.spot).toEqual(LAYUP);
    expect(keptTaps()).toEqual([[first.id, LAYUP]]);
    save(0);
    await flush();
    sync();

    // Saved: one write at a time...
    const second = session.record('fg3_miss');
    save(1);
    await flush();
    sync();
    session.markSpot(CORNER);
    session.markSpot(ELBOW);
    session.markSpot(CORNER);
    expect(spots.map(({ id, location }) => [id, location])).toEqual([
      [first.id, LAYUP],
      [second.id, CORNER],
    ]);
    saveSpot(0);
    saveSpot(1);
    await flush();
    // ...and a spot moved away and back meanwhile needs no other.
    expect(spots).toHaveLength(2);
    expect(stored().map((event) => [event.id, event.location])).toEqual([
      [first.id, LAYUP],
      [second.id, CORNER],
    ]);
    expect(keptTaps()).toEqual([]);
    expect(keptSpots()).toEqual([]);
  });

  it('writes a spot again if it moved while the last one was being saved', async () => {
    const { session, save, sync, stored, spots, saveSpot } = setUp();
    const shot = session.record('fg3_made');
    save(0);
    await flush();
    sync();
    session.markSpot(CORNER);
    session.markSpot(ELBOW);
    expect(spots).toHaveLength(1);
    saveSpot(0);
    await flush();
    expect(spots.map(({ location }) => location)).toEqual([CORNER, ELBOW]);
    expect(keptSpots()).toEqual([[shot.id, ELBOW]]);
    saveSpot(1);
    await flush();
    expect(stored().map((event) => event.location)).toEqual([ELBOW]);
    expect(keptSpots()).toEqual([]);
  });

  it('closes the court once its time is up, even if its timer is late', async () => {
    vi.useFakeTimers();
    const { session } = setUp();
    const listener = vi.fn();
    session.subscribe(listener);
    session.record('fg2_made');
    await vi.advanceTimersByTimeAsync(SPOT_WINDOW_MS - 1);
    expect(session.markSpot(ELBOW)).toBe(true);
    listener.mockClear();
    await vi.advanceTimersByTimeAsync(1);
    expect(session.getSnapshot().spotShot).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    expect(session.markSpot(LAYUP)).toBe(false);
    expect(keptTaps().map(([, spot]) => spot)).toEqual([ELBOW]);

    // The page was in the background: the clock moved on, but no timer ran yet.
    session.record('fg3_made');
    vi.setSystemTime(Date.now() + SPOT_WINDOW_MS);
    expect(session.markSpot(CORNER)).toBe(false);
    expect(session.getSnapshot().spotShot).toBeNull();
  });

  it('closes the court on Undo and on a period change', () => {
    const { session } = setUp();
    const spotShot = () => session.getSnapshot().spotShot;
    session.record('fg2_made');
    void session.movePeriod(2);
    expect(spotShot()).toBeNull();
    session.record('fg2_made');
    void session.undoLatest();
    expect(spotShot()).toBeNull();
    const shot = session.record('fg3_made');
    void session.undo(shot).removal;
    expect(spotShot()).toBeNull();
    session.record('fg3_made');
    session.closeSpot();
    expect(spotShot()).toBeNull();
    expect(session.markSpot(ELBOW)).toBe(false);
  });

  it('undoes a shot with its spot, saved or not', async () => {
    const { session, saves, save, fail, sync, stored, spots, saveSpot, deletes } = setUp();
    // Not saved: the tap goes, spot and all, and is never saved.
    const unsaved = session.record('fg2_made');
    fail(0);
    await flush();
    session.markSpot(ELBOW);
    expect(await outcome(session.undo(unsaved))).toEqual(['fg2_made', 'removed']);
    expect(keptTaps()).toEqual([]);
    session.retry();
    expect(saves).toHaveLength(1);

    // Saved, with its spot being saved: the stat goes, and its spot isn't kept.
    const saved = session.record('fg3_miss');
    save(1);
    await flush();
    sync();
    session.markSpot(CORNER);
    expect(keptSpots()).toEqual([[saved.id, CORNER]]);
    const taking = session.undoLatest();
    expect(keptSpots()).toEqual([]);
    saveSpot(0);
    expect(await outcome(taking)).toEqual(['fg3_miss', 'removed']);
    expect(stored()).toEqual([]);
    expect(deletes).toEqual([unsaved.id, saved.id]);
    session.retry();
    expect(spots).toHaveLength(1);
    expect(keptTaps()).toEqual([]);
    expect(keptSpots()).toEqual([]);
  });

  it('keeps the spot of a stat that could not be undone, and still saves it', async () => {
    const { session, save, sync, stored, spots, saveSpot, failSpot, failDeletes } = setUp();
    // Two saved shots whose spots couldn't be put on them yet: one the screen shows
    // among the saved stats, one saved a moment ago (still held as a tap).
    const shown = session.record('fg3_made');
    save(0);
    await flush();
    sync();
    session.markSpot(CORNER);
    failSpot(0);
    const held = session.record('fg2_made');
    save(1);
    await flush();
    session.markSpot(ELBOW);
    failSpot(1);
    await flush();
    expect(keptSpots()).toEqual([
      [shown.id, CORNER],
      [held.id, ELBOW],
    ]);

    // Undo can't remove them: each counts again, and so does its spot.
    failDeletes(true);
    expect(await outcome(session.undo(held))).toEqual(['fg2_made', 'failed']);
    expect(await outcome(session.undo(shown))).toEqual(['fg3_made', 'failed']);
    expect(keptSpots().sort()).toEqual(
      [
        [shown.id, CORNER],
        [held.id, ELBOW],
      ].sort(),
    );

    // The next retry puts them on their stats (in the order they came back).
    failDeletes(false);
    session.retry();
    expect(spots.slice(2).map(({ id, location }) => [id, location])).toEqual([
      [held.id, ELBOW],
      [shown.id, CORNER],
    ]);
    saveSpot(2);
    saveSpot(3);
    await flush();
    expect(stored().map((event) => [event.id, event.location])).toEqual([
      [shown.id, CORNER],
      [held.id, ELBOW],
    ]);
    expect(keptSpots()).toEqual([]);
  });

  it("tries a spot that couldn't be saved again with the taps, and keeps it meanwhile", async () => {
    vi.useFakeTimers();
    const { session, save, sync, stored, spots, saveSpot, failSpot } = setUp();
    const shot = session.record('fg2_made');
    save(0);
    await vi.advanceTimersByTimeAsync(0);
    sync();
    session.markSpot(ELBOW);
    failSpot(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(keptSpots()).toEqual([[shot.id, ELBOW]]);
    // Once on its own...
    await vi.advanceTimersByTimeAsync(AUTO_RETRY_MS);
    expect(spots).toHaveLength(2);
    failSpot(1);
    await vi.advanceTimersByTimeAsync(10 * AUTO_RETRY_MS);
    expect(spots).toHaveLength(2);
    // ...then with the next tap (or Retry, or when the page is shown again).
    session.record('stl');
    expect(spots).toHaveLength(3);
    saveSpot(2);
    save(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(stored().map((event) => [event.type, event.location])).toEqual([
      ['fg2_made', ELBOW],
      ['stl', undefined],
    ]);
    expect(keptTaps()).toEqual([]);
    expect(keptSpots()).toEqual([]);
  });

  it('counts a spot not on its stat yet as not saved when the game ends', async () => {
    const { session, save, sync, saveSpot, failSpot } = setUp();
    session.record('fg3_miss');
    save(0);
    await flush();
    sync();
    session.markSpot(CORNER);
    // End game waits for the spot's write too: it fails.
    const ending = session.saveAll();
    failSpot(0);
    expect(await ending).toEqual({ count: 1, kept: true });
    // Trying again retries it: saved.
    const again = session.saveAll();
    saveSpot(1);
    expect(await again).toEqual({ count: 0, kept: true });
  });

  it('starts with the spots an earlier page kept, and puts them on their stats, never as taps', async () => {
    const { deps, spots, store, saveSpot, stored } = fakeDeps();
    store(event('three', 'fg3_made', 5));
    addPendingSpot({ id: 'three', gameId: 'g', location: CORNER });
    addPendingSpot({ id: 'elsewhere', gameId: 'other', location: ELBOW });
    const session = new TrackingSession('g', 1, deps);
    // Not a tap: it isn't counted, listed as not saved, or undone.
    expect(session.getSnapshot()).toMatchObject({ pending: [], unsaved: [] });
    session.syncSavedEvents(stored());
    session.retry();
    expect(spots.map(({ id, location }) => [id, location])).toEqual([['three', CORNER]]);
    saveSpot(0);
    await flush();
    expect(stored().map((each) => [each.id, each.location])).toEqual([['three', CORNER]]);
    // (Another game's spot is that game's session's to save.)
    expect(keptSpots()).toEqual([['elsewhere', ELBOW]]);
  });

  it('counts, lists and undoes a shot as one tap, spot or not', async () => {
    const { session, fail, sync, store } = setUp();
    store(event('old', 'fg2_made', 1));
    sync();
    const shot = session.record('fg2_made');
    fail(0);
    await flush();
    session.markSpot(ELBOW);
    expect(session.count('fg2_made')).toBe(2);
    expect(session.getSnapshot().unsaved.map((tap) => [tap.id, tap.location])).toEqual([
      [shot.id, ELBOW],
    ]);
    expect(await outcome(session.undoLatest())).toEqual(['fg2_made', 'removed']);
    expect(session.count('fg2_made')).toBe(1);
  });

  describe('with the real database', () => {
    const newGame = () =>
      createGame({ opponent: 'Central', date: '2026-09-27', periodFormat: 'quarters' });
    const broken = () => Promise.reject(new DOMException('Connection lost.', 'UnknownError'));

    /** A saved shot whose spot couldn't be put on it (nor by the retry after a second). */
    async function shotWithKeptSpot(spot: CourtPoint) {
      const game = await newGame();
      const session = new TrackingSession(game.id, 1, {
        recordStat: savePendingStat,
        deleteStat,
        setCurrentPeriod,
        setStatLocation: broken,
      });
      const shot = session.record('fg3_made');
      await vi.waitFor(async () => expect(await getGameEvents(game.id)).toHaveLength(1));
      session.syncSavedEvents(await getGameEvents(game.id));
      session.markSpot(spot);
      await new Promise((resolve) => setTimeout(resolve, AUTO_RETRY_MS + 50));
      expect(keptSpots()).toEqual([[shot.id, spot]]);
      expect(keptTaps()).toEqual([]);
      return { game, shot, session };
    }

    it('saves a spot the page could not save when the app starts again, once', async () => {
      const { game, shot } = await shotWithKeptSpot(CORNER);

      // The page reloads, and the app's start saves what was kept.
      expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
      expect(await getGameEvents(game.id)).toEqual([
        {
          id: shot.id,
          gameId: game.id,
          type: 'fg3_made',
          period: 1,
          createdAt: shot.at,
          location: CORNER,
        },
      ]);
      expect(keptSpots()).toEqual([]);
      expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
    });

    it('never brings back a shot deleted after its spot was kept: at app start', async () => {
      const { game, shot } = await shotWithKeptSpot(ELBOW);
      // The game ends and the parent deletes that shot on the game report: its kept spot
      // goes with it.
      expect(await deleteStat(shot.id)).toBeDefined();
      expect(keptSpots()).toEqual([]);
      expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
      expect(await getGameEvents(game.id)).toEqual([]);

      // Even a spot kept for a stat deleted some other way (a backup restored over it,
      // say) is only ever put on its stat: the replay drops it, and adds nothing.
      addPendingSpot({ id: shot.id, gameId: game.id, location: ELBOW });
      expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 1, failed: 0 });
      expect(await getGameEvents(game.id)).toEqual([]);
      expect(keptSpots()).toEqual([]);
    });

    it('never brings back a shot deleted after its spot was kept: on the game screen', async () => {
      const { game, shot } = await shotWithKeptSpot(CORNER);
      await deleteStat(shot.id);
      addPendingSpot({ id: shot.id, gameId: game.id, location: CORNER });

      // A relaunch that opens the game screen: its new session starts with the kept
      // spot, but not as a stat to save (nothing is listed as not saved).
      const after = new TrackingSession(game.id, 1);
      after.syncSavedEvents(await getGameEvents(game.id));
      expect(after.getSnapshot()).toMatchObject({ pending: [], unsaved: [] });
      after.retry();
      await vi.waitFor(() => expect(keptSpots()).toEqual([]));
      expect(await getGameEvents(game.id)).toEqual([]);
      expect(await after.saveAll()).toEqual({ count: 0, kept: true });
    });

    it('saves a tap kept with its spot when the game screen opens again, once', async () => {
      const game = await newGame();
      const before = new TrackingSession(game.id, 2, {
        recordStat: broken,
        deleteStat,
        setCurrentPeriod,
        setStatLocation: broken,
      });
      const shot = before.record('fg2_miss');
      await vi.waitFor(() => expect(before.getSnapshot().unsaved).toHaveLength(1));
      before.markSpot(ELBOW);

      // A reload: the new screen's session starts with the kept tap, spot and all.
      const after = new TrackingSession(game.id, 2);
      expect(after.getSnapshot().unsaved).toEqual([{ ...shot, location: ELBOW }]);
      after.retry();
      await vi.waitFor(() => expect(after.getSnapshot().unsaved).toEqual([]));
      expect(await getGameEvents(game.id)).toEqual([
        {
          id: shot.id,
          gameId: game.id,
          type: 'fg2_miss',
          period: 2,
          createdAt: shot.at,
          location: ELBOW,
        },
      ]);
      expect(keptTaps()).toEqual([]);
      expect(keptSpots()).toEqual([]);
    });
  });
});

describe('disposeTrackingSessions', () => {
  it("stops every game's session: no more retries, or journal writes, after a test", async () => {
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    // A tap that can't be saved or kept: its session will try again in a second.
    const save = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Connection lost'));
    const keep = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const session = trackingSession(game.id, 1);
    session.record('stl');
    await vi.waitFor(() => expect(session.getSnapshot().unsaved).toHaveLength(1));
    const saves = save.mock.calls.length;

    // The test ends here (src/test/setup.ts does this after each one), and the next one
    // can keep taps again: a retry of this session's would fail and keep its tap there.
    disposeTrackingSessions();
    keep.mockRestore();
    await new Promise((resolve) => setTimeout(resolve, AUTO_RETRY_MS + 300));
    expect(save.mock.calls.length).toBe(saves);
    expect(listPendingStats()).toEqual([]);
    // And the next test gets a new session for the game.
    expect(trackingSession(game.id, 1)).not.toBe(session);
  });
});
