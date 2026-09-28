import type { Page } from '@playwright/test';

/**
 * Test data through `window.hoopStats`, the console API installed by src/main.tsx.
 * e2e code can't import app modules (they use the `@/` alias), so the shapes it
 * needs are repeated here; e2e/data.spec.ts fails if they drift.
 */

export interface DemoOptions {
  /** Local 'YYYY-MM-DD' the demo games count back from (default: today). */
  today?: string;
  /** Also add a live game today, in the third quarter. */
  liveGame?: boolean;
  /**
   * Replace data the test itself created, too. Seeding refuses to touch anything but
   * earlier demo data without it (a fresh Playwright context starts empty).
   */
  force?: boolean;
}

/** The parts of an export file that tests look at (see ExportFile in src/data/transfer.ts). */
export interface ExportedData {
  exportedAt: string;
  players: { id: string; name: string; jerseyNumber?: string }[];
  games: { id: string; opponent: string; date: string; status: 'live' | 'final' }[];
  events: {
    id: string;
    gameId: string;
    type: string;
    period: number;
    location?: { x: number; y: number };
  }[];
}

interface HoopStatsWindow {
  hoopStats: {
    seedDemoData(options?: DemoOptions): Promise<void>;
    clearAllData(): Promise<void>;
    exportAll(): Promise<ExportedData>;
  };
}

/** Id of the nth demo game: 1 is the oldest, 10 the newest. */
export function demoGameId(n: number): string {
  return `demo-game-${String(n).padStart(2, '0')}`;
}

/** Id of the live demo game (seeded with `{ liveGame: true }`). */
export const DEMO_LIVE_GAME_ID = 'demo-live';

async function waitForApi(page: Page) {
  await page.waitForFunction(() => 'hoopStats' in window);
}

/**
 * Replaces all data with the demo season: "Ava" #12 and ten final games. Call it
 * after the app has loaded (e.g. `page.goto('./')`), then navigate.
 */
export async function seedDemoData(page: Page, options: DemoOptions = {}): Promise<void> {
  await waitForApi(page);
  await page.evaluate(
    (opts) => (window as unknown as HoopStatsWindow).hoopStats.seedDemoData(opts),
    options,
  );
}

/** Deletes every player, game, stat and setting. */
export async function clearAllData(page: Page): Promise<void> {
  await waitForApi(page);
  await page.evaluate(() => (window as unknown as HoopStatsWindow).hoopStats.clearAllData());
}

/** Everything stored on the device, as a backup file would hold it. */
export async function exportAll(page: Page): Promise<ExportedData> {
  await waitForApi(page);
  return page.evaluate(() => (window as unknown as HoopStatsWindow).hoopStats.exportAll());
}

/** The fields of a stored game that `patchGames` can change. */
export interface GamePatch {
  season?: string;
  date?: string;
  opponent?: string;
}

/**
 * Changes stored games straight in IndexedDB, for states the demo data can't make
 * (a long season name, games in another year). Call it after `seedDemoData`, then
 * load the page afresh (e.g. `page.goto('about:blank')` and back) so the app reads
 * the change. Test data only: the app itself always writes through src/data/repo.ts.
 */
export async function patchGames(page: Page, patches: Record<string, GamePatch>): Promise<void> {
  await page.evaluate(async (byId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hoop-stats');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open the database'));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('games', 'readwrite');
        const games = transaction.objectStore('games');
        for (const [id, patch] of Object.entries(byId)) {
          const read = games.get(id);
          read.onsuccess = () => {
            if (!read.result) throw new Error(`No game ${id}`);
            games.put({ ...(read.result as object), ...patch });
          };
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Patch failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Patch aborted'));
      });
    } finally {
      db.close();
    }
  }, patches);
}
