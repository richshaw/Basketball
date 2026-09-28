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
