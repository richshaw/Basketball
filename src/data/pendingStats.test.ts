import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  addPendingStat,
  forgetPendingStat,
  forgetPendingStats,
  hasPendingStats,
  holdUnsavedTaps,
  isPendingStat,
  listPendingStats,
  newPendingStat,
  notifyPendingStats,
  removePendingStat,
  watchPendingStats,
  type PendingStat,
} from './pendingStats';

const T0 = new Date(2026, 8, 27, 18, 0).getTime();
const KEY_PREFIX = 'hoop-stats.pendingStat.';

afterEach(() => {
  vi.useRealTimers();
});

function stat(overrides: Partial<PendingStat> = {}): PendingStat {
  return { id: 'tap-1', gameId: 'game-1', type: 'stl', period: 2, at: T0, ...overrides };
}

/** The journal's own keys in localStorage. */
function journalKeys(): string[] {
  return Object.keys(localStorage)
    .filter((key) => key.startsWith(KEY_PREFIX))
    .sort();
}

describe('the pending-stats journal', () => {
  it('keeps each tap under its own key until it is forgotten', () => {
    const steal = stat({ id: 'a', at: T0 + 20 });
    const shot = stat({ id: 'b', type: 'fg3_made', at: T0 + 10, location: { x: -20, y: 8 } });
    expect(addPendingStat(steal)).toBe(true);
    expect(addPendingStat(shot)).toBe(true);

    expect(journalKeys()).toEqual([`${KEY_PREFIX}a`, `${KEY_PREFIX}b`]);
    // In tap order.
    expect(listPendingStats()).toEqual([shot, steal]);
    expect(isPendingStat('a')).toBe(true);

    removePendingStat('a');
    expect(journalKeys()).toEqual([`${KEY_PREFIX}b`]);
    expect(isPendingStat('a')).toBe(false);
    expect(listPendingStats()).toEqual([shot]);
    removePendingStat('not-kept');
    expect(listPendingStats()).toEqual([shot]);
  });

  it("lists one game's taps", () => {
    addPendingStat(stat({ id: 'a', gameId: 'game-1' }));
    addPendingStat(stat({ id: 'b', gameId: 'game-2' }));
    expect(listPendingStats('game-2').map((each) => each.id)).toEqual(['b']);
    expect(listPendingStats('game-3')).toEqual([]);
  });

  it('gives each new tap its own id, and a tap time after the one given', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: T0 });
    const first = newPendingStat({ gameId: 'game-1', type: 'ast', period: 1 });
    const second = newPendingStat({ gameId: 'game-1', type: 'ast', period: 1 }, first.at);
    const shot = newPendingStat(
      { gameId: 'game-1', type: 'fg2_made', period: 3, location: { x: 1, y: 2 } },
      T0 + 500,
    );
    expect(first).toEqual({
      id: expect.any(String) as string,
      gameId: 'game-1',
      type: 'ast',
      period: 1,
      at: T0,
    });
    expect(second.at).toBe(T0 + 1);
    expect(shot).toMatchObject({ period: 3, at: T0 + 501, location: { x: 1, y: 2 } });
    expect(new Set([first.id, second.id, shot.id]).size).toBe(3);
  });

  it("skips entries it can't save, and leaves them (and other keys) alone", () => {
    const good = stat({ id: 'good' });
    addPendingStat(good);
    const unreadable = {
      [`${KEY_PREFIX}garbled`]: '{"id":',
      [`${KEY_PREFIX}null`]: 'null',
      [`${KEY_PREFIX}other-key`]: JSON.stringify(stat({ id: 'mismatch' })),
      [`${KEY_PREFIX}dunk`]: JSON.stringify(stat({ id: 'dunk', type: 'dunk' as 'stl' })),
      [`${KEY_PREFIX}period`]: JSON.stringify(stat({ id: 'period', period: 0 })),
      [`${KEY_PREFIX}time`]: JSON.stringify(stat({ id: 'time', at: 1.5 })),
    };
    for (const [key, value] of Object.entries(unreadable)) localStorage.setItem(key, value);
    localStorage.setItem('hoop-stats.lastBackupFile', '{}');

    expect(listPendingStats()).toEqual([good]);
    expect(Object.keys(localStorage)).toHaveLength(Object.keys(unreadable).length + 2);
  });

  it('drops a location that could never be saved, but never the tap', () => {
    localStorage.setItem(
      `${KEY_PREFIX}nan`,
      // NaN can't be written as JSON: it comes back as null.
      JSON.stringify(stat({ id: 'nan', type: 'fg2_made', location: { x: Number.NaN, y: 3 } })),
    );
    addPendingStat(stat({ id: 'ft', type: 'ft_made', location: { x: 0, y: 13.75 } }));
    expect(listPendingStats()).toEqual([
      stat({ id: 'ft', type: 'ft_made' }),
      stat({ id: 'nan', type: 'fg2_made' }),
    ]);
  });

  it('carries on when localStorage throws: full, or blocked altogether', () => {
    addPendingStat(stat({ id: 'kept' }));
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(addPendingStat(stat({ id: 'not-kept' }))).toBe(false);
    expect(listPendingStats().map((each) => each.id)).toEqual(['kept']);
    full.mockRestore();

    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(addPendingStat(stat({ id: 'blocked' }))).toBe(false);
    // Can't tell: not "gone", which would drop a tap that may well still be kept.
    expect(isPendingStat('kept')).toBeUndefined();
    expect(listPendingStats()).toEqual([]);
    expect(() => removePendingStat('kept')).not.toThrow();
  });
});

describe('what is pending', () => {
  it('counts the kept taps and the taps held in memory, kept or not', () => {
    expect(hasPendingStats()).toBe(false);
    addPendingStat(stat());
    expect(hasPendingStats()).toBe(true);
    removePendingStat('tap-1');
    expect(hasPendingStats()).toBe(false);

    let unsaved = true;
    const release = holdUnsavedTaps({
      gameId: 'game-1',
      hasUnsaved: () => unsaved,
      retryQuietly: () => Promise.resolve(),
      forget: () => {},
    });
    expect(hasPendingStats()).toBe(true);
    unsaved = false;
    expect(hasPendingStats()).toBe(false);
    unsaved = true;
    release();
    expect(hasPendingStats()).toBe(false);
  });

  it('tells its watchers when a tap may have become pending, until they stop', () => {
    const listener = vi.fn();
    const stop = watchPendingStats(listener);
    notifyPendingStats();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    notifyPendingStats();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('forgetting taps whose data is deleted or replaced', () => {
  /** A (fake) session holding taps of `gameId` in memory, until the test ends. */
  function holdTaps(gameId: string) {
    const forget = vi.fn();
    const release = holdUnsavedTaps({
      gameId,
      hasUnsaved: () => false,
      retryQuietly: () => Promise.resolve(),
      forget,
    });
    onTestFinished(release);
    return forget;
  }

  function keepUnreadable(id: string, gameId: string) {
    // E.g. kept by a newer version of the app, with a stat type this one doesn't know.
    localStorage.setItem(`${KEY_PREFIX}${id}`, JSON.stringify({ id, gameId, type: 'dunk' }));
  }

  it("forgets one game's taps, even ones this version can't read, and its sessions forget theirs", () => {
    addPendingStat(stat({ id: 'a', gameId: 'game-1' }));
    addPendingStat(stat({ id: 'b', gameId: 'game-2' }));
    keepUnreadable('c', 'game-1');
    localStorage.setItem(`${KEY_PREFIX}garbled`, '{"id":');
    const forgetOne = holdTaps('game-1');
    const forgetTwo = holdTaps('game-2');

    forgetPendingStats('game-1');
    expect(journalKeys()).toEqual([`${KEY_PREFIX}b`, `${KEY_PREFIX}garbled`]);
    expect(forgetOne).toHaveBeenCalledExactlyOnceWith();
    expect(forgetTwo).not.toHaveBeenCalled();
  });

  it('forgets them all, leaving no game id or stat type in localStorage, and nothing else', () => {
    addPendingStat(stat({ id: 'a', gameId: 'game-1' }));
    keepUnreadable('c', 'game-2');
    localStorage.setItem(`${KEY_PREFIX}garbled`, '{"id":');
    localStorage.setItem('hoop-stats.lastBackupFile', '{"savedAt":1}');
    const forgetOne = holdTaps('game-1');
    const forgetTwo = holdTaps('game-2');

    forgetPendingStats();
    expect(Object.entries(localStorage)).toEqual([['hoop-stats.lastBackupFile', '{"savedAt":1}']]);
    expect(forgetOne).toHaveBeenCalledExactlyOnceWith();
    expect(forgetTwo).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps the entries again if the data could not be deleted after all, and says so', () => {
    const steal = stat({ id: 'a', gameId: 'game-1' });
    addPendingStat(steal);
    keepUnreadable('c', 'game-1');
    const listener = vi.fn();
    onTestFinished(watchPendingStats(listener));

    const keepAgain = forgetPendingStats('game-1');
    expect(journalKeys()).toEqual([]);
    keepAgain();
    expect(journalKeys()).toEqual([`${KEY_PREFIX}a`, `${KEY_PREFIX}c`]);
    expect(listPendingStats()).toEqual([steal]);
    // The app-wide retry wakes up for them.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forgets one tap by its id, kept or held in memory', () => {
    addPendingStat(stat({ id: 'a' }));
    addPendingStat(stat({ id: 'b' }));
    const forget = holdTaps('game-1');
    forgetPendingStat('a');
    expect(listPendingStats().map((each) => each.id)).toEqual(['b']);
    expect(forget).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('carries on without localStorage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    const forget = holdTaps('game-1');
    expect(() => forgetPendingStats()()).not.toThrow();
    expect(forget).toHaveBeenCalledTimes(1);
  });
});
