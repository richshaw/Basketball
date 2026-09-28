import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addPendingStat,
  isPendingStat,
  listPendingStats,
  newPendingStat,
  removePendingStat,
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
    expect(isPendingStat('kept')).toBe(false);
    expect(listPendingStats()).toEqual([]);
    expect(() => removePendingStat('kept')).not.toThrow();
  });
});
