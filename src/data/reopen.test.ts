import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { db } from './db';
import { useGames } from './hooks';
import {
  isDatabaseClosedError,
  setReopenDelaysForTests,
  watchDatabase,
  type DatabaseChange,
} from './reopen';
import { createGame, getGame, listGames } from './repo';

const lost = () =>
  new DOMException(
    'Connection to Indexed Database server lost. Refresh the page to try again',
    'UnknownError',
  );

/**
 * WebKit loses its IndexedDB connection, and can't open one again until `restore()`:
 * Dexie closes the database (as its onclose handler does), and every open fails.
 */
function loseConnection() {
  const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
    throw lost();
  });
  db.close({ disableAutoOpen: false });
  return { restore: () => open.mockRestore() };
}

/** What watchDatabase() says, for this test. */
function watchChanges(): DatabaseChange[] {
  const changes: DatabaseChange[] = [];
  onTestFinished(watchDatabase((change) => changes.push(change)));
  return changes;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  // Dexie warns as it works around a failed open; that's expected here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('opening the database again once it closed for good', () => {
  it('says it closed, opens it again once it can, and says so', async () => {
    setReopenDelaysForTests([30]);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const changes = watchChanges();
    const connection = loseConnection();

    // The next read opens it, and that fails: Dexie gives up, and every read (and write)
    // from then on fails at once, whatever happens to the connection.
    await expect(getGame(game.id)).rejects.toMatchObject({ name: 'DatabaseClosedError' });
    await vi.waitFor(() => expect(changes).toEqual(['closed']));
    const error = await getGame(game.id).catch((failure: unknown) => failure);
    expect(isDatabaseClosedError(error)).toBe(true);
    // Tried again, and still closed while the connection is lost.
    await sleep(100);
    expect(db.isOpen()).toBe(false);
    expect(changes).toEqual(['closed']);

    connection.restore();
    await vi.waitFor(() => expect(changes).toEqual(['closed', 'reopened']));
    expect(db.isOpen()).toBe(true);
    expect(await getGame(game.id)).toEqual(game);
  });

  it('waits longer between tries, and tries at once when the app comes back into view', async () => {
    setReopenDelaysForTests([60, 400]);
    const opens = vi.spyOn(db, 'open');
    const changes = watchChanges();
    const connection = loseConnection();
    await expect(listGames()).rejects.toThrow();
    // (That read opened it: once.)
    expect(opens).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(changes).toEqual(['closed']));

    // 60 ms later, then every 400 ms.
    await vi.waitFor(() => expect(opens).toHaveBeenCalledTimes(2), { timeout: 1000 });
    await sleep(200);
    expect(opens).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(opens).toHaveBeenCalledTimes(3), { timeout: 1000 });

    // The app comes back into view: tried at once, and it opens.
    connection.restore();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(changes).toEqual(['closed', 'reopened']), { timeout: 200 });
    expect(opens).toHaveBeenCalledTimes(4);
    // Open: nothing more is tried.
    await sleep(500);
    expect(opens).toHaveBeenCalledTimes(4);
  });

  it('leaves a database that opens again by itself alone', async () => {
    const opens = vi.spyOn(db, 'open');
    const changes = watchChanges();
    // Closed (the connection was lost, say), but it can open again: the next read does.
    db.close({ disableAutoOpen: false });
    expect(await listGames()).toEqual([]);
    await sleep(50);
    expect(opens).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([]);
    expect(db.isOpen()).toBe(true);
  });

  it('has every live query read again once it is open, even one whose read was dropped', async () => {
    setReopenDelaysForTests([30]);
    const game = await createGame({
      opponent: 'Central',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const changes = watchChanges();
    const connection = loseConnection();
    await expect(listGames()).rejects.toThrow();
    await vi.waitFor(() => expect(changes).toEqual(['closed']));

    // A screen opened meanwhile: liveQuery drops its failed read without a word, so it
    // shows "loading".
    const { result } = renderHook(() => useGames());
    await sleep(100);
    expect(result.current).toBeUndefined();

    connection.restore();
    await waitFor(() => expect(result.current).toEqual([game]));
  });
});
