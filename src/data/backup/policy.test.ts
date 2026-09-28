import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';
import {
  DEFAULT_TIMINGS,
  hasUnsavedChanges,
  isMuchSmaller,
  pauseReasonFor,
  retryDelayMs,
} from './policy';
import { deriveStatus, type BackupRuntime } from './status';

const MINUTE = 60_000;

describe('backup policy', () => {
  it('backs off 1, 2, 5, 15, then 30 minutes, or longer if the server asks', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((failures) => retryDelayMs(failures, undefined))).toEqual(
      [1, 2, 5, 15, 30, 30, 30].map((minutes) => minutes * MINUTE),
    );
    expect(retryDelayMs(1, 5 * MINUTE)).toBe(5 * MINUTE);
    expect(retryDelayMs(5, 5 * MINUTE)).toBe(30 * MINUTE);
    expect(DEFAULT_TIMINGS).toMatchObject({
      debounceMs: 20_000,
      maxWaitMs: 60_000,
      liveGameMinIntervalMs: 60_000,
    });
  });

  it.each([
    [{}, { games: 0, events: 0 }, false],
    [{ games: 0, events: 0 }, { games: 0, events: 0 }, false],
    [{ games: 1, events: 30 }, { games: 0, events: 0 }, true],
    [{ games: 10, events: 400 }, { games: 0, events: 0 }, true],
    [{ games: 10, events: 400 }, { games: 5, events: 200 }, true],
    [{ games: 10, events: 400 }, { games: 6, events: 240 }, false],
    [{ games: 6, events: 200 }, { games: 3, events: 100 }, true],
    [{ games: 4, events: 160 }, { games: 2, events: 80 }, false],
    [{ games: 5, events: 200 }, { games: 5, events: 0 }, true],
    [{ games: 5, events: 200 }, { games: 5, events: 20 }, false],
    [{ games: 3, events: 90 }, { games: 20, events: 900 }, false],
  ])('shrink guard: from %o to %o is much smaller: %s', (backedUp, current, expected) => {
    expect(isMuchSmaller(backedUp, current)).toBe(expected);
  });

  it('knows when the phone has changes the cloud lacks', () => {
    expect(hasUnsavedChanges({}, undefined)).toBe(true);
    expect(hasUnsavedChanges({ lastSuccessAt: 1 }, undefined)).toBe(false);
    expect(hasUnsavedChanges({}, 5)).toBe(true);
    expect(hasUnsavedChanges({ lastUploadedChangeAt: 5 }, 5)).toBe(false);
    expect(hasUnsavedChanges({ lastUploadedChangeAt: 5 }, 6)).toBe(true);
  });

  it('pauses only for failures retrying cannot fix', () => {
    expect(pauseReasonFor('unauthorized')).toBe('code-rejected');
    expect(pauseReasonFor('account-deleted')).toBe('cloud-deleted');
    expect(pauseReasonFor('too-large')).toBe('too-large');
    for (const kind of ['network', 'server-busy', 'server-full', 'account-limit'] as const) {
      expect(pauseReasonFor(kind)).toBeUndefined();
    }
  });

  it('words failures for what the parent was doing', () => {
    expect(errorMessage('unauthorized', 'restore')).toBe(
      "There's no backup for this code. Check the code and try again.",
    );
    expect(errorMessage('unauthorized', 'backup')).toContain('Turn cloud backup off and on');
    expect(errorMessage('offline', 'delete')).toContain("your cloud backup wasn't deleted");
    expect(errorMessage('wrong-code', 'restore')).toContain("doesn't match");
    expect(errorMessage('internal' as never, 'backup')).toContain('will try again');
  });
});

describe('backup status', () => {
  const online: BackupRuntime = { uploading: false, online: true };
  const stored = { code: 'CODE', enabledAt: 1, lastUploadedChangeAt: 10, lastSuccessAt: 20 };
  const status = (overrides: object, runtime = online, lastChangeAt = 10) =>
    deriveStatus({ available: true, stored: { ...stored, ...overrides }, lastChangeAt, runtime });

  it('is off when unavailable or not turned on', () => {
    const off = { available: true, enabled: false, state: 'idle', pendingChanges: false };
    expect(
      deriveStatus({ available: true, stored: undefined, lastChangeAt: 1, runtime: online }),
    ).toEqual(off);
    expect(deriveStatus({ available: false, stored, lastChangeAt: 1, runtime: online })).toEqual({
      ...off,
      available: false,
    });
  });

  it('works out what the backup is doing', () => {
    expect(status({})).toEqual({
      available: true,
      enabled: true,
      state: 'idle',
      lastSuccessAt: 20,
      pendingChanges: false,
    });
    expect(status({}, { uploading: true, online: true }).state).toBe('backing-up');
    expect(status({}, { uploading: false, online: false }, 11)).toMatchObject({
      state: 'waiting-for-signal',
      pendingChanges: true,
    });
    expect(status({}, { uploading: false, online: false }).state).toBe('idle');
    const networkError = { kind: 'network', message: 'No signal', at: 30 };
    expect(status({ lastError: networkError, nextAttemptAt: 90 }, online, 11)).toMatchObject({
      state: 'waiting-for-signal',
      lastError: networkError,
      nextAttemptAt: 90,
    });
    expect(status({ lastError: { kind: 'server-busy', message: 'Busy', at: 30 } }).state).toBe(
      'error',
    );
    expect(status({ paused: 'cloud-deleted' }).state).toBe('needs-attention');
    expect(
      status({ paused: 'shrink', shrink: { backedUpGames: 10, currentGames: 0, changeAt: 11 } }),
    ).toMatchObject({ state: 'paused-shrink', shrink: { backedUpGames: 10, currentGames: 0 } });
  });
});
