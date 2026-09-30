import { describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { replayPendingStats } from './pendingSaves';
import {
  forgetPendingPeriod,
  forgetPendingPeriods,
  getPendingPeriod,
  isPendingPeriod,
  keepPendingPeriod,
  listPendingPeriods,
  newPendingPeriod,
  type PendingPeriod,
} from './pendingPeriods';
import { forgetPendingStats, hasPendingStats } from './pendingStats';
import * as repo from './repo';
import { createGame, deleteGame, getGame, setCurrentPeriod } from './repo';
import { clearAllData, exportAll, importAll } from './transfer';

const KEY_PREFIX = 'hoop-stats.pendingPeriod.';

function newGame(opponent = 'Lincoln') {
  return createGame({ opponent, date: '2026-09-27', periodFormat: 'quarters' });
}

/** A move of `gameId` to `period`, kept. */
function keptMove(gameId: string, period: number): PendingPeriod {
  const move = newPendingPeriod(gameId, period);
  expect(keepPendingPeriod(move)).toBe(true);
  return move;
}

describe('the pending-periods journal', () => {
  it("keeps a game's latest move, under the game's key, until it's forgotten", () => {
    const first = keptMove('g1', 2);
    const other = keptMove('g2', 3);
    expect(Object.keys(localStorage).sort()).toEqual([`${KEY_PREFIX}g1`, `${KEY_PREFIX}g2`]);
    expect(getPendingPeriod('g1')).toEqual(first);
    expect(isPendingPeriod(first)).toBe(true);

    // A move made since takes its place: the first one is no longer the one to make, and
    // forgetting it (once its period is saved, say) leaves the later one kept.
    const later = keptMove('g1', 3);
    expect(later.id).not.toBe(first.id);
    expect(getPendingPeriod('g1')).toEqual(later);
    expect(isPendingPeriod(first)).toBe(false);
    forgetPendingPeriod(first);
    expect(getPendingPeriod('g1')).toEqual(later);
    forgetPendingPeriod(later);
    expect(getPendingPeriod('g1')).toBeUndefined();
    expect(listPendingPeriods()).toEqual([other]);
    expect(listPendingPeriods('g2')).toEqual([other]);
    expect(listPendingPeriods('g1')).toEqual([]);
  });

  it("forgets a game's moves as its data goes, and keeps them again if that fails", () => {
    keptMove('g1', 2);
    const other = keptMove('g2', 3);
    const forgotten = forgetPendingPeriods('g2');
    expect(forgotten.count).toBe(1);
    expect(listPendingPeriods().map((move) => move.gameId)).toEqual(['g1']);
    forgotten.putBack();
    expect(getPendingPeriod('g2')).toEqual(other);

    // Not one made since, though: that one is the move to make.
    const again = forgetPendingPeriods('g2');
    const since = keptMove('g2', 4);
    again.putBack();
    expect(getPendingPeriod('g2')).toEqual(since);

    // All the data goes: every entry goes, even one this version can't read.
    localStorage.setItem(`${KEY_PREFIX}junk`, '{not json');
    expect(forgetPendingPeriods().count).toBe(3);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("skips entries it can't use, and leaves them (and other keys) alone", () => {
    localStorage.setItem(`${KEY_PREFIX}junk`, '{not json');
    localStorage.setItem(`${KEY_PREFIX}g1`, JSON.stringify({ id: 'm1', gameId: 'g1', period: 21 }));
    localStorage.setItem(
      `${KEY_PREFIX}g2`,
      JSON.stringify({ id: 'm2', gameId: 'g2', period: 1.5 }),
    );
    localStorage.setItem(
      `${KEY_PREFIX}g3`,
      JSON.stringify({ id: 'm3', gameId: 'other', period: 2 }),
    );
    localStorage.setItem(`${KEY_PREFIX}g4`, JSON.stringify({ gameId: 'g4', period: 2 }));
    localStorage.setItem('hoop-stats.pendingStat.tap', JSON.stringify({ id: 'tap' }));
    expect(listPendingPeriods()).toEqual([]);
    expect(getPendingPeriod('g1')).toBeUndefined();
    expect(localStorage).toHaveLength(6);
  });

  it("forgets the game's earlier move when it can't keep a new one, and carries on when localStorage throws", () => {
    const earlier = keptMove('g1', 2);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    // Kept, the earlier move would be saved over this one: it goes.
    expect(keepPendingPeriod(newPendingPeriod('g1', 3))).toBe(false);
    expect(getPendingPeriod('g1')).toBeUndefined();
    expect(isPendingPeriod(earlier)).toBe(false);
    setItem.mockRestore();

    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(keepPendingPeriod(newPendingPeriod('g1', 3))).toBe(false);
    expect(listPendingPeriods()).toEqual([]);
    expect(getPendingPeriod('g1')).toBeUndefined();
    expect(() => forgetPendingPeriod(earlier)).not.toThrow();
  });

  it('counts as pending, so the app-wide retry keeps trying', () => {
    expect(hasPendingStats()).toBe(false);
    const move = keptMove('g1', 2);
    expect(hasPendingStats()).toBe(true);
    forgetPendingPeriod(move);
    expect(hasPendingStats()).toBe(false);
  });
});

describe('setCurrentPeriod with onlyIf', () => {
  it('checks it as the write runs, and writes nothing when it says no', async () => {
    const game = await newGame();
    const move = keptMove(game.id, 2);
    let checked = 0;
    const onlyIf = () => {
      checked += 1;
      return isPendingPeriod(move);
    };
    // Asked for while it's the kept move; by the time the write runs, a move made since
    // (here, or in another tab) has taken its place.
    const writing = setCurrentPeriod(game.id, 2, { onlyIf });
    const since = keptMove(game.id, 3);
    const saved = await writing;
    expect(checked).toBe(1);
    expect(saved).toEqual(game);
    expect(await getGame(game.id)).toEqual(game);

    // The move made since is written.
    expect(
      (await setCurrentPeriod(game.id, 3, { onlyIf: () => isPendingPeriod(since) })).currentPeriod,
    ).toBe(3);
    expect((await getGame(game.id))?.currentPeriod).toBe(3);
  });
});

describe('deleting or replacing data forgets kept moves', () => {
  it("deleteGame forgets its game's move, and only that one, and keeps it if the delete fails", async () => {
    const game = await newGame();
    const other = await newGame('Roosevelt');
    const move = keptMove(game.id, 2);
    const otherMove = keptMove(other.id, 3);

    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Disk full'));
    await expect(deleteGame(game.id)).rejects.toThrow('Disk full');
    expect(getPendingPeriod(game.id)).toEqual(move);

    await deleteGame(game.id);
    expect(listPendingPeriods()).toEqual([otherMove]);
  });

  it('puts back only a move that nothing has kept or forgotten since, when the write fails', async () => {
    const game = await newGame();
    keptMove(game.id, 2);
    const keepAgain = forgetPendingStats(game.id);
    // Meanwhile (the delete is under way), a move made since.
    const since = keptMove(game.id, 3);
    keepAgain();
    expect(getPendingPeriod(game.id)).toEqual(since);
  });

  it('Erase all data forgets every kept move', async () => {
    const game = await newGame();
    keptMove(game.id, 2);
    await clearAllData();
    expect(listPendingPeriods()).toEqual([]);
  });

  it('a replace restore forgets them too, and keeps them if it fails', async () => {
    const game = await newGame();
    const backup = await exportAll();
    const move = keptMove(game.id, 2);

    vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('Disk full'));
    await expect(importAll(backup, 'replace')).rejects.toThrow('Disk full');
    expect(getPendingPeriod(game.id)).toEqual(move);

    await importAll(backup, 'replace');
    expect(listPendingPeriods()).toEqual([]);
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
    expect((await getGame(game.id))?.currentPeriod).toBe(1);
  });
});

describe('replaying kept moves', () => {
  it('moves each game to its kept period once, and drops a move whose game is gone', async () => {
    const game = await newGame();
    const other = await newGame('Roosevelt');
    keptMove(game.id, 2);
    keptMove(other.id, 5);
    keptMove('deleted-game', 3);

    expect(await replayPendingStats()).toEqual({ saved: 2, dropped: 1, failed: 0 });
    expect((await getGame(game.id))?.currentPeriod).toBe(2);
    expect((await getGame(other.id))?.currentPeriod).toBe(5);
    expect(listPendingPeriods()).toEqual([]);
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
  });

  it('forgets a move the game shows already, without writing', async () => {
    const game = await newGame();
    await setCurrentPeriod(game.id, 2);
    const saved = await getGame(game.id);
    keptMove(game.id, 2);
    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect(listPendingPeriods()).toEqual([]);
    expect(await getGame(game.id)).toEqual(saved);
  });

  it("keeps one it couldn't save for next time", async () => {
    const game = await newGame();
    const move = keptMove(game.id, 2);
    vi.spyOn(repo, 'setCurrentPeriod').mockRejectedValueOnce(
      new DOMException('Connection to Indexed Database server lost.', 'UnknownError'),
    );
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 1 });
    expect(getPendingPeriod(game.id)).toEqual(move);
    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect((await getGame(game.id))?.currentPeriod).toBe(2);
  });

  it('never saves a move over one made since it began', async () => {
    const game = await newGame();
    const move = keptMove(game.id, 2);
    let since: PendingPeriod | undefined;
    const { getGame: read } = repo;
    vi.spyOn(repo, 'getGame').mockImplementationOnce(async (id) => {
      const found = await read(id);
      // The parent moves on meanwhile (in this tab, or another).
      since = keptMove(game.id, 3);
      return found;
    });
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
    expect((await getGame(game.id))?.currentPeriod).toBe(1);
    expect(isPendingPeriod(move)).toBe(false);
    expect(getPendingPeriod(game.id)).toEqual(since);

    // That one is saved next.
    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect((await getGame(game.id))?.currentPeriod).toBe(3);
  });
});
