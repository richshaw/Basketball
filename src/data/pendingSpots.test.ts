import { describe, expect, it, vi } from 'vitest';
import { db } from './db';
import {
  addPendingSpot,
  getPendingSpot,
  listPendingSpots,
  removeGamePendingSpots,
  removePendingSpot,
} from './pendingSpots';
import { replayPendingStats } from './pendingStats';
import * as repo from './repo';
import { createGame, deleteGame, deleteStat, getGameEvents, recordStat } from './repo';

const KEY_PREFIX = 'hoop-stats.pendingSpot.';
const ELBOW = { x: -6, y: 13.75 };
const CORNER = { x: 23, y: -3 };

function newGame(opponent = 'Lincoln') {
  return createGame({ opponent, date: '2026-09-27', periodFormat: 'quarters' });
}

describe('the pending-spots journal', () => {
  it('keeps one spot per stat, under its own key, until it is forgotten', () => {
    expect(addPendingSpot({ id: 'a', gameId: 'g1', location: ELBOW })).toBe(true);
    expect(addPendingSpot({ id: 'b', gameId: 'g2', location: CORNER })).toBe(true);
    // A spot moved: the stat's entry is replaced.
    addPendingSpot({ id: 'a', gameId: 'g1', location: CORNER });
    expect(Object.keys(localStorage).sort()).toEqual([`${KEY_PREFIX}a`, `${KEY_PREFIX}b`]);
    expect(getPendingSpot('a')).toEqual({ id: 'a', gameId: 'g1', location: CORNER });
    expect(listPendingSpots('g2')).toEqual([{ id: 'b', gameId: 'g2', location: CORNER }]);
    expect(listPendingSpots()).toHaveLength(2);

    removePendingSpot('a');
    expect(getPendingSpot('a')).toBeUndefined();
    removeGamePendingSpots('g2');
    expect(listPendingSpots()).toEqual([]);
  });

  it("skips entries it can't use, and leaves them (and other keys) alone", () => {
    localStorage.setItem(`${KEY_PREFIX}junk`, '{not json');
    localStorage.setItem(
      `${KEY_PREFIX}nan`,
      JSON.stringify({ id: 'nan', gameId: 'g', location: { x: null, y: 1 } }),
    );
    localStorage.setItem(
      `${KEY_PREFIX}other`,
      JSON.stringify({ id: 'mismatch', gameId: 'g', location: ELBOW }),
    );
    localStorage.setItem('hoop-stats.pendingStat.tap', JSON.stringify({ id: 'tap' }));
    expect(listPendingSpots()).toEqual([]);
    expect(localStorage).toHaveLength(4);
  });

  it('carries on when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(addPendingSpot({ id: 'a', gameId: 'g', location: ELBOW })).toBe(false);
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(listPendingSpots()).toEqual([]);
    expect(getPendingSpot('a')).toBeUndefined();
    expect(() => removePendingSpot('a')).not.toThrow();
  });
});

describe('deleting stats forgets their kept spots', () => {
  it('deleteStat forgets the spot kept for that stat (e.g. deleted on the game report)', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg3_miss');
    const other = await recordStat(game.id, 'fg2_made');
    addPendingSpot({ id: shot.id, gameId: game.id, location: CORNER });
    addPendingSpot({ id: other.id, gameId: game.id, location: ELBOW });

    await deleteStat(shot.id);
    expect(listPendingSpots().map((spot) => spot.id)).toEqual([other.id]);
  });

  it("keeps the spot when the stat couldn't be deleted", async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg3_miss');
    addPendingSpot({ id: shot.id, gameId: game.id, location: CORNER });
    vi.spyOn(db.events, 'delete').mockRejectedValueOnce(new Error('Disk full'));
    await expect(deleteStat(shot.id)).rejects.toThrow('Disk full');
    expect(getPendingSpot(shot.id)).toBeDefined();
    expect(await getGameEvents(game.id)).toHaveLength(1);
  });

  it("deleteGame forgets its game's kept spots, and only those", async () => {
    const game = await newGame();
    const kept = await newGame('Roosevelt');
    const shot = await recordStat(game.id, 'fg3_miss');
    const keptShot = await recordStat(kept.id, 'fg2_miss');
    addPendingSpot({ id: shot.id, gameId: game.id, location: CORNER });
    addPendingSpot({ id: keptShot.id, gameId: kept.id, location: ELBOW });

    await deleteGame(game.id);
    expect(listPendingSpots().map((spot) => spot.id)).toEqual([keptShot.id]);
  });
});

describe('replaying kept spots', () => {
  it('puts each on its stat once, and never adds a stat that is gone', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg3_miss');
    addPendingSpot({ id: shot.id, gameId: game.id, location: CORNER });
    addPendingSpot({ id: 'gone', gameId: game.id, location: ELBOW });
    addPendingSpot({ id: 'no-game', gameId: 'deleted-game', location: ELBOW });

    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 2, failed: 0 });
    expect((await getGameEvents(game.id)).map((event) => [event.id, event.location])).toEqual([
      [shot.id, CORNER],
    ]);
    expect(listPendingSpots()).toEqual([]);
    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
  });

  it("keeps one it couldn't save for next time, and drops one its stat can never take", async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg2_made');
    const steal = await recordStat(game.id, 'stl');
    addPendingSpot({ id: shot.id, gameId: game.id, location: ELBOW });
    // (A steal has no spot: kept by mistake, it's dropped rather than kept forever.)
    addPendingSpot({ id: steal.id, gameId: game.id, location: ELBOW });
    vi.spyOn(repo, 'setStatLocation').mockRejectedValueOnce(
      new DOMException('Connection to Indexed Database server lost.', 'UnknownError'),
    );

    expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 1, failed: 1 });
    expect(listPendingSpots().map((spot) => spot.id)).toEqual([shot.id]);
    expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
    expect((await getGameEvents(game.id)).map((event) => event.location)).toEqual([
      ELBOW,
      undefined,
    ]);
  });

  it('leaves a spot moved on the game screen while it runs to the game screen', async () => {
    const game = await newGame();
    const shot = await recordStat(game.id, 'fg2_made');
    addPendingSpot({ id: shot.id, gameId: game.id, location: ELBOW });
    const { setStatLocation } = repo;
    vi.spyOn(repo, 'setStatLocation').mockImplementationOnce(async (id, location) => {
      // The parent moves the spot meanwhile: the game screen keeps the new one.
      addPendingSpot({ id: shot.id, gameId: game.id, location: CORNER });
      return setStatLocation(id, location);
    });

    await replayPendingStats();
    expect(getPendingSpot(shot.id)?.location).toEqual(CORNER);
  });
});
