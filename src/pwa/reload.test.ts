import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { holdUnsavedTaps } from '@/data/pendingStats';
import { reloadIfSafe } from './reload';

describe('reloadIfSafe', () => {
  it('reloads only while a reload would lose nothing', () => {
    const reload = vi.fn();
    expect(reloadIfSafe(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    // A live game screen holds a tap only in memory (localStorage full, say).
    let safe = false;
    onTestFinished(
      holdUnsavedTaps({
        gameId: 'g1',
        hasUnsaved: () => true,
        reloadSafe: () => safe,
        retryQuietly: () => Promise.resolve(),
        saved: () => {},
        forget: () => () => {},
      }),
    );
    expect(reloadIfSafe(reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    // Saved (or kept on the phone) since.
    safe = true;
    expect(reloadIfSafe(reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
