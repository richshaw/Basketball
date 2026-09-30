import type { Page } from '@playwright/test';

/** The pending-periods journal's keys (src/data/pendingPeriods.ts). */
const KEY_PREFIX = 'hoop-stats.pendingPeriod.';

/** The periods moved to on the live game screen that are kept on the phone, not saved yet. */
export function keptMoves(page: Page): Promise<number[]> {
  return page.evaluate(
    (prefix) =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => (JSON.parse(localStorage.getItem(key) ?? '{}') as { period: number }).period),
    KEY_PREFIX,
  );
}

/**
 * Makes localStorage refuse to keep a period move while `on` (it's full, say): the move
 * then lives only in memory, and a failed one puts the saved period back.
 */
export async function refuseToKeepMoves(page: Page, on: boolean) {
  await page.evaluate(
    ([prefix, refusing]) => {
      const state = window as unknown as { refuseMoves?: boolean };
      if (state.refuseMoves === undefined) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound by call() below
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
          if (state.refuseMoves && key.startsWith(prefix)) {
            throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
          }
          setItem.call(this, key, value);
        };
      }
      state.refuseMoves = refusing;
    },
    [KEY_PREFIX, on] as const,
  );
}
