import { describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { seedDemoData } from './demo';
import {
  addPendingRemoval,
  forgetPendingRemovals,
  listPendingRemovals,
  removePendingRemoval,
  type PendingRemoval,
} from './pendingRemovals';
import { replayPendingStats } from './pendingSaves';
import { hasPendingStats } from './pendingStats';
import * as repo from './repo';
import {
  createGame,
  deleteGame,
  deleteStat,
  getAllEvents,
  getGameEvents,
  recordStat,
} from './repo';
import type { StatEvent } from './types';
import { clearAllData, exportAll, importAll } from './transfer';

const KEY_PREFIX = 'hoop-stats.pendingRemoval.';
const T0 = new Date(2026, 8, 27, 18, 0).getTime();

function removal(overrides: Partial<PendingRemoval> = {}): PendingRemoval {
  return { id: 'tap-1', gameId: 'game-1', type: 'blk', period: 2, at: T0, ...overrides };
}

/** A removal kept for a saved stat, as a session keeps it for a tap taken back. */
function keepRemovalOf(event: StatEvent): void {
  const { id, gameId, type, period, createdAt } = event;
  addPendingRemoval({ id, gameId, type, period, at: createdAt });
}

function newGame(opponent = 'Lincoln') {
  return createGame({ opponent, date: '2026-09-27', periodFormat: 'quarters' });
}

describe('the pending-removals journal', () => {
  it('keeps one entry per stat, under its own key, in tap order, until it is forgotten', () => {
    const later = removal({ id: 'b', at: T0 + 10 });
    const earlier = removal({ id: 'a', gameId: 'game-2', type: 'stl', at: T0 });
    expect(addPendingRemoval(later)).toBe(true);
    expect(addPendingRemoval(earlier)).toBe(true);
    expect(Object.keys(localStorage).sort()).toEqual([`${KEY_PREFIX}a`, `${KEY_PREFIX}b`]);
    expect(listPendingRemovals()).toEqual([earlier, later]);
    expect(listPendingRemovals('game-2')).toEqual([earlier]);
    expect(hasPendingStats()).toBe(true);

    removePendingRemoval('a');
    expect(listPendingRemovals()).toEqual([later]);
    removePendingRemoval('not-kept');
    expect(listPendingRemovals()).toEqual([later]);
    removePendingRemoval('b');
    expect(hasPendingStats()).toBe(false);
  });

  it("forgets one game's or all of them (even ones this version can't read), and keeps them again", () => {
    addPendingRemoval(removal({ id: 'a', gameId: 'game-1' }));
    addPendingRemoval(removal({ id: 'b', gameId: 'game-2' }));
    const forgotten = forgetPendingRemovals('game-1');
    expect(forgotten.count).toBe(1);
    expect(listPendingRemovals().map((each) => each.id)).toEqual(['b']);
    forgotten.putBack();
    expect(listPendingRemovals().map((each) => each.id)).toEqual(['a', 'b']);

    localStorage.setItem(`${KEY_PREFIX}junk`, '{not json');
    expect(forgetPendingRemovals().count).toBe(3);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("skips entries it can't read, and leaves them (and other keys) alone", () => {
    const unreadable = {
      [`${KEY_PREFIX}junk`]: '{not json',
      [`${KEY_PREFIX}other`]: JSON.stringify(removal({ id: 'mismatch' })),
      [`${KEY_PREFIX}dunk`]: JSON.stringify(removal({ id: 'dunk', type: 'dunk' as 'stl' })),
      [`${KEY_PREFIX}time`]: JSON.stringify(removal({ id: 'time', at: 1.5 })),
    };
    for (const [key, value] of Object.entries(unreadable)) localStorage.setItem(key, value);
    localStorage.setItem('hoop-stats.pendingStat.tap', JSON.stringify({ id: 'tap' }));
    expect(listPendingRemovals()).toEqual([]);
    expect(localStorage).toHaveLength(5);
  });

  it('carries on when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(addPendingRemoval(removal())).toBe(false);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(listPendingRemovals()).toEqual([]);
    expect(() => removePendingRemoval('tap-1')).not.toThrow();
    expect(forgetPendingRemovals().count).toBe(0);
  });
});

describe('kept removals, done or forgotten', () => {
  it('the replay removes each kept stat once, and forgets it; one never saved is done too', async () => {
    const game = await newGame();
    const landed = await recordStat(game.id, 'blk');
    const kept = await recordStat(game.id, 'stl');
    keepRemovalOf(landed);
    // Taken back before any save of it landed: nothing to remove, and nothing left to do.
    addPendingRemoval(removal({ id: 'never-saved', gameId: game.id }));

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 1, failed: 0 });
    expect(await getGameEvents(game.id)).toEqual([kept]);
    expect(listPendingRemovals()).toEqual([]);
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
  });

  it("the replay keeps one it couldn't remove, for next time", async () => {
    const game = await newGame();
    const block = await recordStat(game.id, 'blk');
    keepRemovalOf(block);
    vi.spyOn(repo, 'deleteStat').mockRejectedValueOnce(new Error('Connection lost'));
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 1 });
    expect(listPendingRemovals().map((each) => each.id)).toEqual([block.id]);
    expect(hasPendingStats()).toBe(true);

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect(await getGameEvents(game.id)).toEqual([]);
  });

  it('deleteStat forgets the removal kept for that stat, once it is gone', async () => {
    const game = await newGame();
    const block = await recordStat(game.id, 'blk');
    keepRemovalOf(block);
    vi.spyOn(db.events, 'delete').mockRejectedValueOnce(new Error('Disk full'));
    await expect(deleteStat(block.id)).rejects.toThrow('Disk full');
    expect(listPendingRemovals()).toHaveLength(1);

    await deleteStat(block.id);
    expect(listPendingRemovals()).toEqual([]);
  });

  it("deleteGame forgets its game's kept removals, and keeps them if it fails", async () => {
    const game = await newGame();
    const other = await newGame('Roosevelt');
    const block = await recordStat(game.id, 'blk');
    const otherBlock = await recordStat(other.id, 'blk');
    keepRemovalOf(block);
    keepRemovalOf(otherBlock);

    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Disk full'));
    await expect(deleteGame(game.id)).rejects.toThrow('Disk full');
    expect(listPendingRemovals()).toHaveLength(2);
    await deleteGame(game.id);
    expect(listPendingRemovals().map((each) => each.id)).toEqual([otherBlock.id]);
  });

  it('Erase all data and a replace restore forget them: no stat restored is removed later', async () => {
    await seedDemoData({ force: true });
    const [steal] = (await getAllEvents()).filter((event) => event.type === 'stl');
    if (!steal) throw new Error('No sample Steal');
    keepRemovalOf(steal);
    await clearAllData();
    expect(listPendingRemovals()).toEqual([]);
    // "Try it with sample data": the same ids again, and none is removed.
    await seedDemoData({ force: true });
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
    expect((await getGameEvents(steal.gameId)).some((event) => event.id === steal.id)).toBe(true);

    const backup = await exportAll();
    keepRemovalOf(steal);
    await importAll(backup, 'replace');
    expect(listPendingRemovals()).toEqual([]);
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
    expect((await getGameEvents(steal.gameId)).some((event) => event.id === steal.id)).toBe(true);
  });
});
