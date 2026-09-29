import { expect, type Page } from '@playwright/test';
import { paths } from '../../src/routes';
import { appUrl } from './app';

/** The live game screen's parts, found the way a user (or VoiceOver) finds them. */
export const statGrid = (page: Page) => page.getByRole('group', { name: 'Record a stat' });
export const stats = (page: Page) => page.getByRole('list', { name: 'Game stats' });
export const lastAction = (page: Page) => page.getByRole('status', { name: 'Last action' });
/** The last-action line's button (its Undo), not the grid's "Undo last stat". */
export const lineButton = (page: Page, name = 'Undo') =>
  page.getByRole('button', { name, exact: true });
export const notSaved = (page: Page) => page.getByRole('alert');

/** Whether the last-action line shows its whole message: nothing on it is cut off. */
export function lastActionFits(page: Page): Promise<boolean> {
  return lastAction(page).evaluate((status) =>
    Array.from(status.querySelectorAll('*')).every(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  );
}

/** Waits until the stat strip says each text (what a screen reader hears), e.g. 'Points: 9'. */
export async function expectStats(page: Page, ...texts: string[]) {
  for (const text of texts) {
    await expect(stats(page).getByText(text, { exact: true })).toBeAttached();
  }
}

/**
 * Starts a new game from the New game form, like the parent does, and waits for the
 * live game screen. Resolves to the game's id.
 */
export async function startGame(page: Page, opponent = 'Westfield'): Promise<string> {
  await page.goto(appUrl(paths.newGame));
  await page.getByLabel('Opponent').fill(opponent);
  await page.getByRole('button', { name: 'Start game' }).tap();
  await expect(page.getByRole('heading', { level: 1, name: `vs ${opponent}` })).toBeVisible();
  const gameId = /#\/games\/([^/]+)\/track$/.exec(page.url())?.[1];
  if (!gameId) throw new Error(`Not on a live game screen: ${page.url()}`);
  return decodeURIComponent(gameId);
}

/** Taps stat buttons by touch, as fast as the browser takes them (no waiting in between). */
export async function tapStats(page: Page, labels: readonly string[]) {
  const centers = new Map<string, { x: number; y: number }>();
  for (const label of new Set(labels)) {
    const box = await statGrid(page)
      .getByRole('button', { name: label, exact: true })
      .boundingBox();
    if (!box) throw new Error(`No button for ${label}`);
    centers.set(label, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  for (const label of labels) {
    const center = centers.get(label);
    if (center) await page.touchscreen.tap(center.x, center.y);
  }
}

/** Two taps on one spot, `gapMs` apart (a quick double tap is about 120 ms). */
export async function doubleTap(page: Page, name: string, gapMs = 120) {
  const box = await page.getByRole('button', { name, exact: true }).boundingBox();
  if (!box) throw new Error(`No button named ${name}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(gapMs);
  await page.touchscreen.tap(x, y);
}

/** The taps kept on the phone until they're saved (see src/data/pendingStats.ts). */
export function keptTaps(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('hoop-stats.pendingStat.')),
  );
}

/**
 * The taps taken back whose stat is kept on the phone to be removed, until it's confirmed
 * gone (see src/data/pendingRemovals.ts).
 */
export function keptRemovals(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key.startsWith('hoop-stats.pendingRemoval.')),
  );
}

/** A spot on the court in feet: the basket at (0, 0), +y toward half court (src/lib/court.ts). */
export interface CourtSpot {
  x: number;
  y: number;
}

/** The kept taps as stored (type and spot), e.g. to check a spot is kept with its tap. */
export function keptTapSpots(page: Page): Promise<{ type: string; location?: CourtSpot }[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('hoop-stats.pendingStat.'))
      .map((key) => {
        const { type, location } = JSON.parse(localStorage.getItem(key) ?? '{}') as {
          type: string;
          location?: { x: number; y: number };
        };
        return location ? { type, location } : { type };
      }),
  );
}

/** The spots kept on the phone for saved shots until they're on them (src/data/pendingSpots.ts). */
export function keptSpots(page: Page): Promise<{ id: string; location: CourtSpot }[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith('hoop-stats.pendingSpot.'))
      .map((key) => {
        const { id, location } = JSON.parse(localStorage.getItem(key) ?? '{}') as {
          id: string;
          location: { x: number; y: number };
        };
        return { id, location };
      }),
  );
}

/** The shot chart's court on the live game screen (with the Shot chart setting on). */
export const shotCourt = (page: Page) => page.getByRole('img', { name: /^Shot spot/ });

/**
 * Taps the live game screen's court where a shot was taken. The drawing (10 SVG units
 * per foot from the left end of the baseline; e2e code can't import courtGeometry.ts)
 * is scaled to fit its box and centered, so a short court is narrower than its box.
 */
export async function tapCourt(page: Page, spot: CourtSpot) {
  const court = shotCourt(page);
  const box = await court.boundingBox();
  if (!box) throw new Error('The court is not on screen');
  const view = await court.evaluate((svg) => {
    const { x, y, width, height } = (svg as SVGSVGElement).viewBox.baseVal;
    return { x, y, width, height };
  });
  const scale = Math.min(box.width / view.width, box.height / view.height);
  const left = box.x + (box.width - view.width * scale) / 2;
  const top = box.y + (box.height - view.height * scale) / 2;
  await page.touchscreen.tap(
    left + ((spot.x + 25) * 10 - view.x) * scale,
    top + ((spot.y + 5.25) * 10 - view.y) * scale,
  );
}

/** Turns the Shot chart setting on or off in Settings, as the parent would. */
export async function setShotChart(page: Page, on: boolean) {
  await page.goto(appUrl(paths.settings));
  const toggle = page.getByRole('switch', { name: 'Shot chart' });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

/**
 * Waits until every tap so far is saved. (The screen counts a tap from the moment it's
 * made, so the numbers on it don't say that.)
 */
export async function expectAllSaved(page: Page) {
  await expect.poll(() => keptTaps(page)).toEqual([]);
}

/**
 * Makes reading stats fail in IndexedDB, as when WebKit has lost its connection in the
 * background, until it's called again with `fail` false. (Dexie reads a game's stats,
 * and exportAll() every stat, with getAll on an events index; saving a tap doesn't use
 * it, so saves still work.) The page's own exportAll() fails meanwhile too.
 */
export async function failStatReads(page: Page, fail = true) {
  await page.evaluate((failing) => {
    const state = window as unknown as { statReadsFail?: boolean };
    if (state.statReadsFail === undefined) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by apply() below
      const getAll = IDBIndex.prototype.getAll;
      IDBIndex.prototype.getAll = function (this: IDBIndex, ...args) {
        if (state.statReadsFail && this.objectStore.name === 'events') {
          throw new DOMException('Simulated read failure', 'UnknownError');
        }
        return getAll.apply(this, args);
      };
    }
    state.statReadsFail = failing;
  }, fail);
}

/** What the page keeps for loseDatabaseConnection(), from before the app loads. */
interface DatabaseConnections {
  /** The IndexedDB connections the page opened. */
  databaseConnections?: IDBDatabase[];
  /** Opening a connection fails while set. */
  databaseLost?: boolean;
}

/**
 * Lets loseDatabaseConnection() cut the page off from IndexedDB: call it before the
 * page loads (e.g. before startGame). From then on, every page this test loads keeps the
 * connections it opens.
 */
export async function canLoseDatabaseConnection(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as DatabaseConnections;
    const connections: IDBDatabase[] = [];
    state.databaseConnections = connections;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by apply() below
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, ...args) {
      if (state.databaseLost) {
        throw new DOMException(
          'Connection to Indexed Database server lost. Refresh the page to try again',
          'UnknownError',
        );
      }
      const request = open.apply(this, args);
      request.addEventListener('success', () => connections.push(request.result));
      return request;
    };
  });
}

/**
 * Makes the page lose its IndexedDB connection the way WebKit does in the background,
 * until it's called again with `lost` false (see canLoseDatabaseConnection): each open
 * connection is closed from the server's side (its `close` event), and opening one again
 * fails. Dexie then closes the database, and gives up on it once the next read or write
 * can't open it again: until the app opens it again itself (src/data/reopen.ts), every
 * read and write fails, the page's exportAll() too.
 */
export async function loseDatabaseConnection(page: Page, lost = true) {
  await page.evaluate((losing) => {
    const state = window as unknown as DatabaseConnections;
    if (!state.databaseConnections) throw new Error('Call canLoseDatabaseConnection() first');
    state.databaseLost = losing;
    if (!losing) return;
    for (const connection of state.databaseConnections.splice(0)) {
      connection.dispatchEvent(new Event('close'));
    }
  }, lost);
}

/** The note the live game screen shows while it can't read the saved stats. */
export const readFailedNote = (page: Page) => page.getByText("Can't read saved stats right now.");

/** Tells the page it's been brought back into view, as when the app returns to the front. */
export async function showPageAgain(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/**
 * Makes the next `count` stat saves fail in IndexedDB, as a write can when iOS brings
 * the app back from the background. Each failed save throws inside its transaction.
 */
export async function failNextSaves(page: Page, count: number) {
  await page.evaluate((failures) => {
    const state = window as unknown as { saveFailuresLeft?: number };
    if (state.saveFailuresLeft === undefined) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by apply() below
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args) {
        if (this.name === 'events' && (state.saveFailuresLeft ?? 0) > 0) {
          state.saveFailuresLeft = (state.saveFailuresLeft ?? 0) - 1;
          throw new DOMException('Simulated write failure', 'UnknownError');
        }
        return add.apply(this, args);
      };
    }
    state.saveFailuresLeft = failures;
  }, count);
}

/**
 * Makes removing a stat fail in IndexedDB while `on` (an Undo, say), as a write can when
 * iOS brings the app back from the background: the stat's `delete` throws inside its
 * transaction.
 */
export async function failStatDeletes(page: Page, on: boolean) {
  await page.evaluate((failing) => {
    const state = window as unknown as { failStatDeletes?: boolean };
    if (state.failStatDeletes === undefined) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by apply() below
      const remove = IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete = function (this: IDBObjectStore, ...args) {
        if (this.name === 'events' && state.failStatDeletes) {
          throw new DOMException('Simulated write failure', 'UnknownError');
        }
        return remove.apply(this, args);
      };
    }
    state.failStatDeletes = failing;
  }, on);
}

/**
 * Makes saving the game itself fail in IndexedDB while `on` (moving to another period,
 * say), as a write can when iOS brings the app back from the background: the game's
 * `put` throws inside its transaction. (A stat's save writes the game too, so taps fail
 * meanwhile as well.)
 */
export async function failGameSaves(page: Page, on: boolean) {
  await page.evaluate((failing) => {
    const state = window as unknown as { failGameSaves?: boolean };
    if (state.failGameSaves === undefined) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by apply() below
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
        if (this.name === 'games' && state.failGameSaves) {
          throw new DOMException('Simulated write failure', 'UnknownError');
        }
        return put.apply(this, args);
      };
    }
    state.failGameSaves = failing;
  }, on);
}

/**
 * Makes saving a spot onto a saved shot fail in IndexedDB while `on`, as a write can
 * when iOS brings the app back from the background: the stat's `put` (setStatLocation)
 * throws inside its transaction. New stats are saved with `add`, so they still save.
 */
export async function failSpotSaves(page: Page, on: boolean) {
  await page.evaluate((failing) => {
    const state = window as unknown as { failSpotSaves?: boolean };
    if (state.failSpotSaves === undefined) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by apply() below
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
        if (this.name === 'events' && state.failSpotSaves) {
          throw new DOMException('Simulated write failure', 'UnknownError');
        }
        return put.apply(this, args);
      };
    }
    state.failSpotSaves = failing;
  }, on);
}
