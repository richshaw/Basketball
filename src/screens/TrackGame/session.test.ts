import { afterEach, describe, expect, it, vi } from 'vitest';
import { savePendingStat } from '@/data/pendingSaves';
import {
  addPendingStat,
  hasPendingStats,
  listPendingStats,
  type PendingStat,
} from '@/data/pendingStats';
import * as repo from '@/data/repo';
import { createGame, deleteGame, deleteStat, getGameEvents, setCurrentPeriod } from '@/data/repo';
import type { StatEvent, StatType } from '@/data/types';
import {
  AUTO_RETRY_MS,
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
  };

  /** Stores save number `index`'s stat (once per id), without answering it. */
  const land = (index: number): StatEvent => {
    const call = saves[index];
    if (!call) throw new Error(`No save #${index}`);
    const { id, type, period, at } = call.stat;
    let event = stored.find((each) => each.id === id);
    if (!event) {
      event = { id, gameId: 'g', type, period, createdAt: at };
      stored = [...stored, event].sort((a, b) => a.createdAt - b.createdAt);
    }
    return event;
  };
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

    // The page reloads: memory is gone, the journal isn't. The new session counts the
    // tap (it can be undone too) and saves it.
    const after = new TrackingSession(game.id, 2);
    expect(after.getSnapshot()).toMatchObject({ pending: [block], unsaved: [] });
    after.retry();
    await vi.waitFor(() => expect(keptIds()).toEqual([]));
    expect(after.getSnapshot().unsaved).toEqual([]);
    expect(await getGameEvents(game.id)).toEqual([
      { id: block.id, gameId: game.id, type: 'blk', period: 2, createdAt: block.at },
    ]);
    expect(keptIds()).toEqual([]);
    after.retry();
    await flush();
    expect(await getGameEvents(game.id)).toHaveLength(1);
  });

  it('counts the taps an earlier page kept, and says one is not saved only once a save of it fails', async () => {
    addPendingStat({ id: 'kept', gameId: 'g', type: 'stl', period: 1, at: 5 });
    const { session, saves, fail, pendingTypes, unsavedTypes } = setUp();
    // No "not saved" before any save of it was tried on this page.
    expect(pendingTypes()).toEqual(['stl']);
    expect(unsavedTypes()).toEqual([]);
    expect(saves).toHaveLength(0);

    session.retry(); // as the screen opens
    expect(saves).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ unsaved: [], retrying: false });
    fail(0);
    await flush();
    expect(unsavedTypes()).toEqual(['stl']);
    expect(session.getSnapshot().unsavedKept).toBe(true);
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

  describe('retryQuietly (the app-wide retry)', () => {
    it('tries a tap again without saying so on screen, and settles once it has', async () => {
      const { session, saves, save, fail, unsavedTypes } = setUp();
      session.record('stl');
      fail(0);
      await flush();
      expect(session.hasUnsaved()).toBe(true);
      const snapshot = session.getSnapshot();

      let settled = false;
      void session.retryQuietly().then(() => {
        settled = true;
      });
      expect(saves).toHaveLength(2);
      // Nothing on screen changes while it's tried: no "Saving again…" every few seconds.
      expect(session.getSnapshot()).toBe(snapshot);
      await flush();
      expect(settled).toBe(false);
      save(1);
      await flush();
      expect(settled).toBe(true);
      expect(unsavedTypes()).toEqual([]);
      expect(session.hasUnsaved()).toBe(false);
      expect(keptIds()).toEqual([]);
    });

    it('says it is saving again if Retry is tapped meanwhile, without saving twice', async () => {
      const { session, saves, save, fail } = setUp();
      session.record('stl');
      fail(0);
      await flush();
      void session.retryQuietly();
      expect(session.getSnapshot().retrying).toBe(false);
      session.retry();
      expect(saves).toHaveLength(2);
      expect(session.getSnapshot().retrying).toBe(true);
      save(1);
      await flush();
      expect(session.getSnapshot()).toMatchObject({ unsaved: [], retrying: false });
    });

    it('tries a tap the journal could not keep too', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });
      const { session, save, fail, storedTypes } = setUp();
      session.record('ast');
      fail(0);
      await flush();
      expect(session.getSnapshot().unsavedKept).toBe(false);
      const tried = session.retryQuietly();
      save(1);
      await tried;
      expect(storedTypes()).toEqual(['ast']);
      expect(session.hasUnsaved()).toBe(false);
    });

    it('has nothing to try once every tap is saved or taken back', async () => {
      const { session, saves, save, fail } = setUp();
      const steal = session.record('stl');
      session.record('ast');
      fail(0);
      save(1);
      await flush();
      expect(session.hasUnsaved()).toBe(true);
      await session.undo(steal).removal;
      expect(session.hasUnsaved()).toBe(false);
      await session.retryQuietly();
      expect(saves).toHaveLength(2);
    });
  });

  describe("when its game's data is deleted or replaced", () => {
    it('forgets every tap, and never saves one again', async () => {
      const { session, saves, fail, pendingTypes } = setUp();
      session.record('stl');
      session.record('ast');
      fail(0);
      fail(1);
      await flush();
      session.forget();
      expect(pendingTypes()).toEqual([]);
      expect(session.getSnapshot().unsaved).toEqual([]);
      expect(session.hasUnsaved()).toBe(false);
      await session.retryQuietly();
      session.retry();
      expect(saves).toHaveLength(2);
    });

    it('forgets the tap of a stat deleted elsewhere, but not one being taken back here', async () => {
      const { session, fail, pendingTypes } = setUp();
      const steal = session.record('stl');
      session.record('ast');
      fail(0);
      fail(1);
      await flush();
      session.forget(steal.id);
      expect(pendingTypes()).toEqual(['ast']);

      const block = session.record('blk');
      const taking = session.undo(block);
      session.forget(block.id);
      fail(3);
      expect(await taking.removal).toBe('removed');
    });

    it('drops a kept tap that is no longer kept (saved meanwhile, or erased in another tab)', async () => {
      const { session, saves, fail, pendingTypes } = setUp();
      const steal = session.record('stl');
      fail(0);
      await flush();
      expect(pendingTypes()).toEqual(['stl']);
      localStorage.removeItem(`hoop-stats.pendingStat.${steal.id}`);
      session.retry();
      expect(saves).toHaveLength(1);
      expect(pendingTypes()).toEqual([]);
    });
  });

  describe('trackingSession (one per game)', () => {
    it('holds its taps for the app-wide retry until its game is deleted, then starts afresh', async () => {
      const game = await createGame({
        opponent: 'Central',
        date: '2026-09-27',
        periodFormat: 'quarters',
      });
      vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Connection lost'));
      const session = trackingSession(game.id, 1);
      expect(trackingSession(game.id, 1)).toBe(session);
      session.record('stl');
      await vi.waitFor(() => expect(session.getSnapshot().unsaved).toHaveLength(1));
      expect(hasPendingStats()).toBe(true);

      await deleteGame(game.id);
      expect(session.getSnapshot().pending).toEqual([]);
      expect(hasPendingStats()).toBe(false);
      expect(trackingSession(game.id, 1)).not.toBe(session);
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
