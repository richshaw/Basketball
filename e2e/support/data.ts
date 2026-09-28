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
  events: { id: string; gameId: string; type: string; period: number }[];
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
