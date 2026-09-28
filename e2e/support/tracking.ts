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
 * Waits until every tap so far is saved. (The screen counts a tap from the moment it's
 * made, so the numbers on it don't say that.)
 */
export async function expectAllSaved(page: Page) {
  await expect.poll(() => keptTaps(page)).toEqual([]);
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
