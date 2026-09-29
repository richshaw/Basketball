/**
 * Opening the database again once it has closed for good.
 *
 * WebKit can lose its IndexedDB connection while the app is in the background. Dexie then
 * closes the database, and opens it again on the next read or write. If that open fails
 * too (the connection isn't back yet), Dexie gives up for good: from then on every read
 * and write fails with a DatabaseClosedError (which liveQuery drops without a word), and
 * only a page reload would open it again.
 *
 * This doesn't wait for a reload. The moment the database closes for good, it says so
 * (watchDatabase: the live game screen reads again, and shows that it can't) and tries to
 * open it again: db.close({ disableAutoOpen: false }) clears the failed open (as Dexie's
 * own handler for a lost connection closes it), and db.open() then opens afresh (Dexie 4
 * does, after a failed open). It tries REOPEN_DELAYS_MS later (1 s, 3 s, 10 s, then every
 * 30 s), and at once when the app comes back into view. One try at a time, never while
 * the database is open or being opened, and never in the way of a tap: a tap is kept and
 * counted as ever, and its save simply fails (and is kept) until the database is back. A
 * try that doesn't answer within REOPEN_TRY_LIMIT_MS (WebKit's open can hang) is
 * cancelled with db.close(), so the tries after it still run.
 * Once it is, every live query reads again (as Dexie does itself for a page restored from
 * the back-forward cache), and the watchers hear of it: the live game screen and the
 * app-wide retry save what they hold.
 */
import { Dexie, RangeSet } from 'dexie';
import { db } from './db';

/** How long to wait before each try to open it again, in a row; the last from then on. */
export const REOPEN_DELAYS_MS: readonly number[] = [1000, 3000, 10_000, 30_000];

/**
 * How long one try may take. WebKit's open can fail to answer at all, now and then: the
 * try is then cancelled (db.close()), and the next one scheduled.
 */
export const REOPEN_TRY_LIMIT_MS = 10_000;

/** The waits in use: REOPEN_DELAYS_MS, unless a test set shorter ones. */
let delaysMs = REOPEN_DELAYS_MS;
/** The limit in use: REOPEN_TRY_LIMIT_MS, unless a test set a shorter one. */
let tryLimitMs = REOPEN_TRY_LIMIT_MS;

/** What watchDatabase() hears: the database closed for good, or it's open again. */
export type DatabaseChange = 'closed' | 'reopened';

/** Whether `error` is Dexie's DatabaseClosedError: the database is closed, not just busy. */
export function isDatabaseClosedError(error: unknown): boolean {
  return error instanceof Error && error.name === Dexie.errnames.DatabaseClosed;
}

/**
 * Whether Dexie has given up on the database: it's closed after an open failed (or after
 * a close that turned opening off), so no read or write opens it again. (Closed with
 * `disableAutoOpen: false`, the next read or write opens it: that's not this.)
 */
function closedForGood(): boolean {
  return !db.isOpen() && db.hasFailed();
}

const watchers = new Set<(change: DatabaseChange) => void>();

/** Trying to open it again: from finding it closed for good until it's open. */
let recovering = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let trying = false;
/** Tries in a row that failed: how far the waits have backed off. */
let misses = 0;

/**
 * Calls `listener` when the database closes for good, and when it's open again after
 * that. Returns a function that stops it.
 */
export function watchDatabase(listener: (change: DatabaseChange) => void): () => void {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}

function tell(change: DatabaseChange): void {
  for (const watcher of [...watchers]) watcher(change);
}

function schedule(): void {
  clearTimeout(timer);
  const delay = delaysMs[Math.min(misses, delaysMs.length - 1)] ?? 0;
  timer = setTimeout(() => {
    timer = undefined;
    void tryToReopen();
  }, delay);
}

function tryWhenShown(): void {
  if (document.visibilityState === 'visible') void tryToReopen();
}

/** Tries at once whenever the app comes back into view, or stops (where there's a page). */
function tryWhenAppShown(on: boolean): void {
  if (typeof document === 'undefined') return;
  if (on) document.addEventListener('visibilitychange', tryWhenShown);
  else document.removeEventListener('visibilitychange', tryWhenShown);
}

/** Whether it's closed for good: then it says so, and starts trying to open it again. */
function check(): void {
  if (recovering || !closedForGood()) return;
  recovering = true;
  tryWhenAppShown(true);
  schedule();
  tell('closed');
}

/** Opens it: open() waits for one being opened, and is done if it's open. */
function openWithinLimit(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const limit = setTimeout(() => {
      // It never answered: cancelled, so the next try opens afresh (with auto-open off
      // meanwhile, reads and writes fail at once, as they did while it was closed).
      db.close();
      reject(new Error('Opening the database again did not answer in time.'));
    }, tryLimitMs);
    db.open().then(
      () => {
        clearTimeout(limit);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(limit);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function tryToReopen(): Promise<void> {
  if (!recovering || trying) return;
  clearTimeout(timer);
  timer = undefined;
  trying = true;
  try {
    // Only a database Dexie gave up on is closed first (an open one would lose the
    // writes under way).
    if (db.hasFailed()) db.close({ disableAutoOpen: false });
    await openWithinLimit();
  } catch {
    // Still closed, or the try never answered: tried again later.
  } finally {
    trying = false;
  }
  if (!recovering) return;
  if (!db.isOpen()) {
    misses += 1;
    schedule();
    return;
  }
  recovering = false;
  misses = 0;
  tryWhenAppShown(false);
  // Every live query reads again: those that failed meanwhile were dropped without a word.
  Dexie.on.storagemutated.fire({ all: new RangeSet(-Infinity, [[]]) });
  tell('reopened');
}

// Dexie closes the database when an open fails, which is how it comes to be closed for
// good (and when the connection is lost, or another tab upgrades it: then the next read
// or write opens it again by itself). Checked just after, once Dexie has settled.
db.on('close', () => {
  setTimeout(check, 0);
});

/**
 * For tests: waits to use instead of REOPEN_DELAYS_MS (and a limit for each try instead
 * of REOPEN_TRY_LIMIT_MS), until stopReopeningDatabase().
 */
export function setReopenDelaysForTests(
  delays: readonly number[],
  tryLimit = REOPEN_TRY_LIMIT_MS,
): void {
  delaysMs = delays;
  tryLimitMs = tryLimit;
}

/**
 * For the test setup, after each test: stops trying to open it again, and forgets how
 * far the waits had backed off (and any waits a test set), so nothing carries into the
 * next test.
 */
export function stopReopeningDatabase(): void {
  recovering = false;
  misses = 0;
  delaysMs = REOPEN_DELAYS_MS;
  tryLimitMs = REOPEN_TRY_LIMIT_MS;
  clearTimeout(timer);
  timer = undefined;
  tryWhenAppShown(false);
}
