import { describe, expect, it } from 'vitest';
import { buildDemoData } from '../demo';
import { describeWait, errorMessage } from './errors';
import {
  DEFAULT_TIMINGS,
  hasUnsavedChanges,
  pauseReasonFor,
  realData,
  retryDelayMs,
  shrinkCheck,
} from './policy';
import { deriveStatus, type BackupRuntime } from './status';

const MINUTE = 60_000;
const ids = (count: number, prefix = 'g') =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}`);

describe('backup policy', () => {
  it('backs off 1, 2, 5, 15, then 30 minutes, or longer if the server asks', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map((failures) => retryDelayMs(failures, undefined))).toEqual(
      [1, 2, 5, 15, 30, 30, 30].map((minutes) => minutes * MINUTE),
    );
    expect(retryDelayMs(1, 5 * MINUTE)).toBe(5 * MINUTE);
    expect(retryDelayMs(5, 5 * MINUTE)).toBe(30 * MINUTE);
  });

  it('uploads in a quiet spell during a live game, and at least every 5 minutes', () => {
    expect(DEFAULT_TIMINGS).toMatchObject({
      debounceMs: 20_000,
      maxWaitMs: 60_000,
      liveGameMaxWaitMs: 5 * MINUTE,
      liveGameMinIntervalMs: 60_000,
      gameEndDelayMs: 2000,
    });
  });

  it('counts only the parent’s own games, never sample games', () => {
    const demo = buildDemoData({ today: '2026-09-27', liveGame: true });
    expect(realData(demo)).toEqual({ gameIds: [], events: 0 });
    const own = { ...demo.games[0]!, id: 'own-game' };
    const ownEvents = demo.events.slice(0, 3).map((event) => ({ ...event, gameId: own.id }));
    expect(
      realData({ games: [...demo.games, own], events: [...demo.events, ...ownEvents] }),
    ).toEqual({ gameIds: ['own-game'], events: 3 });
  });

  it.each([
    // [backed-up games, games on the phone, backed-up stats, stats on the phone, held?]
    ['no backup yet', [], ids(0), 0, 0, false],
    ['everything erased', ids(10), [], 400, 0, true],
    ['the one game deleted', ids(1), [], 30, 0, true],
    ['half of 10 gone', ids(10), ids(10).slice(5), 400, 200, true],
    ['4 of 10 gone', ids(10), ids(10).slice(4), 400, 240, false],
    ['2 of 4 gone (fewer than 3)', ids(4), ids(4).slice(2), 160, 80, false],
    ['3 of 6 gone', ids(6), ids(6).slice(3), 200, 100, true],
    ['every stat gone', ids(5), ids(5), 200, 0, true],
    ['a new season on top', ids(10), [...ids(10), ...ids(12, 'new')], 400, 900, false],
    ['a new season instead', ids(10), ids(12, 'new'), 400, 500, true],
  ])(
    'shrink guard, %s: held back is %s',
    (_name, backedUp, onPhone, backedUpEvents, events, held) => {
      const finding = shrinkCheck(
        { backedUpGameIds: backedUp, backedUpEventCount: backedUpEvents },
        { gameIds: onPhone, events: events },
      );
      expect(finding !== undefined).toBe(held);
      if (finding) {
        const onPhoneIds = new Set(onPhone);
        expect(finding).toEqual({
          backedUpGames: backedUp.length,
          missingGames: backedUp.filter((id) => !onPhoneIds.has(id)).length,
        });
      }
    },
  );

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
});

describe('backup messages', () => {
  it('words failures for what the parent was doing', () => {
    expect(errorMessage('unauthorized', 'restore')).toBe(
      "There's no backup for this code. Check the code and try again.",
    );
    expect(errorMessage('unauthorized', 'backup')).toContain(
      'turn cloud backup off and delete its online copy, then turn it back on',
    );
    expect(errorMessage('unauthorized', 'backup')).not.toContain('off and on again');
    expect(errorMessage('offline', 'delete')).toContain("your cloud backup wasn't deleted");
    expect(errorMessage('wrong-code', 'restore')).toContain("doesn't match");
    expect(errorMessage('internal' as never, 'backup')).toContain('will try again');
  });

  it("blames this phone, not the server, for this phone's failures", () => {
    for (const context of ['backup', 'restore', 'delete'] as const) {
      const message = errorMessage('unexpected', context);
      expect(message).toContain('on this phone');
      expect(message).not.toContain('server');
    }
  });

  it('says when a busy server will be tried again', () => {
    expect(errorMessage('rate-limited', 'backup', 20 * 60 * MINUTE)).toBe(
      'The backup server is busy. Hoop Stats will try again in 20 hours.',
    );
    expect(errorMessage('server-busy', 'backup', 5000)).toBe(
      'The backup server is busy. Hoop Stats will try again in a minute.',
    );
    expect(errorMessage('server-busy', 'backup')).toContain('in a few minutes');
    expect(errorMessage('rate-limited', 'restore', 3 * MINUTE)).toBe(
      'The backup server is busy. Try again in 3 minutes.',
    );
    expect(errorMessage('rate-limited', 'delete', 90 * MINUTE)).toContain('Try again in 2 hours');
    expect(
      [30_000, 61_000, 59 * MINUTE, 60 * MINUTE, 47 * 60 * MINUTE, 49 * 60 * MINUTE].map(
        describeWait,
      ),
    ).toEqual([
      'in a minute',
      'in 2 minutes',
      'in 59 minutes',
      'in an hour',
      'in 47 hours',
      'in 3 days',
    ]);
  });
});

describe('backup status', () => {
  const online: BackupRuntime = { uploading: false, online: true };
  const code = 'CODE';
  const stored = { code, enabledAt: 1, lastUploadedChangeAt: 10, lastSuccessAt: 20 };
  const status = (overrides: object, runtime = online, lastChangeAt = 10) =>
    deriveStatus({ available: true, stored: { ...stored, ...overrides }, lastChangeAt, runtime });

  it('is off when unavailable, without a code, or turned off', () => {
    const off = { available: true, enabled: false, state: 'idle', pendingChanges: false };
    expect(
      deriveStatus({ available: true, stored: undefined, lastChangeAt: 1, runtime: online }),
    ).toEqual(off);
    expect(status({ disabledAt: 30 }, online, 11)).toEqual(off);
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
      status({ paused: 'shrink', shrink: { backedUpGames: 10, missingGames: 10, changeAt: 11 } }),
    ).toMatchObject({ state: 'paused-shrink', shrink: { backedUpGames: 10, missingGames: 10 } });
    expect(
      status({ paused: 'other-device', otherDevice: { version: 'v9', createdAt: 55 } }),
    ).toMatchObject({ state: 'paused-other-device', otherDevice: { backedUpAt: 55 } });
  });
});
