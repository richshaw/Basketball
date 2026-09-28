import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatEvent, StatType } from '@/data/types';
import { AUTO_RETRY_MS, TrackingSession, type SessionDeps } from './session';

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

/**
 * A fake database: each write waits until the test answers it (`save`/`fail`), so
 * every interleaving of taps and answers can be played out exactly.
 */
function fakeDeps() {
  const saves: { type: StatType; period: number; answer: Deferred<StatEvent> }[] = [];
  const deletes: string[] = [];
  const moves: { period: number; answer: Deferred<unknown> }[] = [];
  const stored: StatEvent[] = [];
  let failDeletes = false;
  let nextId = 1;

  const deps: SessionDeps = {
    recordStat: (_gameId, type, period) => {
      const answer = deferred<StatEvent>();
      saves.push({ type, period, answer });
      return answer.promise;
    },
    deleteStat: (eventId) => {
      deletes.push(eventId);
      if (failDeletes) return Promise.reject(new Error('Disk error'));
      const index = stored.findIndex((event) => event.id === eventId);
      return Promise.resolve(index >= 0 ? stored.splice(index, 1)[0] : undefined);
    },
    setCurrentPeriod: (_gameId, period) => {
      const answer = deferred<unknown>();
      moves.push({ period, answer });
      return answer.promise;
    },
  };

  /** Answers save number `index` (0-based, in call order) with a stored event. */
  const save = (index: number): StatEvent => {
    const call = saves[index];
    if (!call) throw new Error(`No save #${index}`);
    const event: StatEvent = {
      id: `e${nextId++}`,
      gameId: 'g',
      type: call.type,
      period: call.period,
      createdAt: nextId,
    };
    stored.push(event);
    call.answer.resolve(event);
    return event;
  };
  const fail = (index: number) => saves[index]?.answer.reject(new Error('Disk error'));

  return {
    deps,
    saves,
    deletes,
    moves,
    stored,
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
  return { ...fake, session, unsavedTypes };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('TrackingSession', () => {
  it('saves each tap at once, in the period on screen at the tap', async () => {
    const { session, saves, save, moves, storedTypes } = setUp(3);
    session.record('stl');
    void session.movePeriod(4);
    // Tapped before the move is saved: still in the period on screen, Q4.
    const tap = session.record('ast');
    expect(tap.period).toBe(4);
    expect(saves.map(({ type, period }) => [type, period])).toEqual([
      ['stl', 3],
      ['ast', 4],
    ]);
    expect(moves.map((move) => move.period)).toEqual([4]);
    save(0);
    save(1);
    await flush();
    expect(storedTypes()).toEqual(['stl', 'ast']);
  });

  it('keeps a tap that failed through later taps, and saves it first on the next tap', async () => {
    const { session, saves, save, fail, unsavedTypes, storedTypes } = setUp(2);
    session.record('stl');
    fail(0);
    await flush();
    expect(unsavedTypes()).toEqual(['stl']);

    // The next tap retries the Steal first, in its own period, then saves itself.
    void session.movePeriod(3);
    session.record('ast');
    expect(saves.map(({ type, period }) => [type, period])).toEqual([
      ['stl', 2],
      ['stl', 2],
      ['ast', 3],
    ]);
    expect(session.getSnapshot().retrying).toBe(true);
    expect(unsavedTypes()).toEqual(['stl']);
    save(1);
    save(2);
    await flush();
    expect(unsavedTypes()).toEqual([]);
    expect(storedTypes()).toEqual(['stl', 'ast']);
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

  it('never retries a tap that was undone, even if its save fails after the Undo', async () => {
    vi.useFakeTimers();
    const { session, saves, fail, unsavedTypes, storedTypes } = setUp();
    const steal = session.record('stl');
    const removed = session.undo(steal);
    fail(0);
    expect(await removed).toBe(true);
    expect(unsavedTypes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5 * AUTO_RETRY_MS);
    session.record('ast');
    expect(saves.map((call) => call.type)).toEqual(['stl', 'ast']);
    expect(storedTypes()).toEqual([]);

    // Undone after it failed: dropped, and not retried by the next tap either.
    const block = session.record('blk');
    fail(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(unsavedTypes()).toEqual(['blk']);
    expect(await session.undo(block)).toBe(true);
    expect(unsavedTypes()).toEqual([]);
    session.retry();
    expect(saves.map((call) => call.type)).toEqual(['stl', 'ast', 'blk']);
  });

  it('removes an undone tap once its save lands, and only once', async () => {
    const { session, save, deletes, storedTypes } = setUp();
    const tap = session.record('fg3_made');
    const first = session.undo(tap);
    const second = session.undo(tap);
    const event = save(0);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(deletes).toEqual([event.id]);
    expect(storedTypes()).toEqual([]);
  });

  it('counts a tap again if its stat could not be removed', async () => {
    const { session, save, failDeletes, storedTypes } = setUp();
    const tap = session.record('foul');
    save(0);
    await flush();
    failDeletes(true);
    expect(await session.undo(tap)).toBe(false);
    expect(storedTypes()).toEqual(['foul']);
    failDeletes(false);
    const outcome = session.undoLatest([]);
    expect(outcome).toMatchObject({ type: 'foul' });
    expect(typeof outcome === 'object' && (await outcome.done)).toBe(true);
    expect(storedTypes()).toEqual([]);
  });

  describe('undoLatest (the grid Undo)', () => {
    const before: StatEvent[] = [
      { id: 'old1', gameId: 'g', type: 'dreb', period: 1, createdAt: 1 },
      { id: 'old2', gameId: 'g', type: 'ast', period: 1, createdAt: 2 },
    ];

    it('takes back the latest tap, saved or not, then stats from before', async () => {
      const { session, save, fail, stored, deletes, unsavedTypes } = setUp();
      stored.push(...before);
      session.record('stl');
      session.record('blk');
      save(0);
      fail(1);
      await flush();
      expect(unsavedTypes()).toEqual(['blk']);

      // The Block was never saved: dropped at once.
      expect(session.undoLatest(stored)).toMatchObject({ type: 'blk' });
      expect(unsavedTypes()).toEqual([]);
      expect(deletes).toEqual([]);

      const steal = session.undoLatest(stored);
      expect(steal).toMatchObject({ type: 'stl' });
      // A second Undo while the first is still removing its stat is ignored.
      expect(session.undoLatest(stored)).toBe('busy');
      expect(typeof steal === 'object' && (await steal.done)).toBe(true);

      // Then the stats from before this session, newest first, by id.
      const assist = session.undoLatest([...before]);
      expect(assist).toMatchObject({ type: 'ast' });
      expect(typeof assist === 'object' && (await assist.done)).toBe(true);
      // Even if the list on screen hasn't caught up yet, the Assist isn't counted twice.
      const rebound = session.undoLatest([...before]);
      expect(rebound).toMatchObject({ type: 'dreb' });
      expect(typeof rebound === 'object' && (await rebound.done)).toBe(true);
      expect(session.undoLatest([...before])).toBe('nothing');
      expect(deletes).toEqual(['e1', 'old2', 'old1']);
      expect(stored).toEqual([]);
    });

    it('takes back a tap still being saved, removing it once saved', async () => {
      const { session, save, stored, deletes } = setUp();
      stored.push(...before);
      session.record('stl');
      const outcome = session.undoLatest(stored);
      expect(outcome).toMatchObject({ type: 'stl' });
      // Not busy: the next Undo already goes to the stat before it.
      expect(session.undoLatest(stored)).toMatchObject({ type: 'ast' });
      const event = save(0);
      await flush();
      expect(deletes).toEqual(['old2', event.id]);
      expect(stored.map((each) => each.id)).toEqual(['old1']);
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
    const { session, save, fail } = setUp();
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    const snapshot = session.getSnapshot();
    session.record('ast');
    save(0);
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toBe(snapshot);

    session.record('stl');
    fail(1);
    await flush();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    void session.movePeriod(2);
    expect(listener).toHaveBeenCalledOnce();
  });
});
