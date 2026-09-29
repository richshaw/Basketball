import { describe, expect, it } from 'vitest';
import type { StoredBackupState } from './state';
import { checksShrink, deriveStatus, shownBackupState, type BackupRuntime } from './status';

/** Backed up four games of her own (40 stats), when the data last changed at 10. */
const backedUp: StoredBackupState = {
  code: 'TEST-CODE',
  enabledAt: 1,
  lastSuccessAt: 11,
  lastUploadedChangeAt: 10,
  backedUpGameIds: ['a', 'b', 'c', 'd'],
  backedUpEventCount: 40,
  lastVersion: 'v1',
};
const everything = { gameIds: ['a', 'b', 'c', 'd'], events: 40 };
const erased = { gameIds: [], events: 0 };
const idle: BackupRuntime = { uploading: false, forced: false, online: true };
const shrinkError = { kind: 'shrink', message: 'Some games…', at: 30 };
/** As the engine stores it when an upload is held back for the erased phone. */
const pausedAt20: StoredBackupState = {
  ...backedUp,
  paused: 'shrink',
  shrink: { backedUpGames: 4, missingGames: 4, changeAt: 20 },
  lastError: shrinkError,
};

function status(
  stored: StoredBackupState,
  lastChangeAt: number,
  current: { gameIds: string[]; events: number } | undefined,
  runtime: BackupRuntime = idle,
) {
  return deriveStatus({ available: true, stored, lastChangeAt, current, runtime });
}

describe('checksShrink', () => {
  it('is true when the next automatic upload would check the data now', () => {
    expect(checksShrink(backedUp, 20)).toBe(true);
    // A stored shrink pause is checked again once the data has changed since.
    expect(checksShrink(pausedAt20, 25)).toBe(true);
  });

  it('is false with nothing to upload, the same data checked, another pause, or backup off', () => {
    expect(checksShrink(backedUp, 10)).toBe(false);
    expect(checksShrink(pausedAt20, 20)).toBe(false);
    expect(checksShrink({ ...backedUp, paused: 'other-device' }, 20)).toBe(false);
    expect(checksShrink({ ...backedUp, paused: 'code-rejected' }, 20)).toBe(false);
    expect(checksShrink({ ...backedUp, disabledAt: 5 }, 20)).toBe(false);
    expect(checksShrink(undefined, 20)).toBe(false);
  });
});

describe('shownBackupState', () => {
  it('pauses as the next upload would, without storing anything', () => {
    expect(shownBackupState(backedUp, 20, erased)).toEqual({
      ...backedUp,
      paused: 'shrink',
      shrink: { backedUpGames: 4, missingGames: 4 },
    });
    expect(shownBackupState(backedUp, 20, everything)).toBe(backedUp);
  });

  it('drops a stored shrink pause, and its message, once the games are back', () => {
    const { paused: _paused, shrink: _shrink, lastError: _lastError, ...rest } = pausedAt20;
    expect(shownBackupState(pausedAt20, 25, everything)).toEqual(rest);
    // A failure of another kind stays.
    const failed = { ...pausedAt20, lastError: { ...shrinkError, kind: 'network' } };
    expect(shownBackupState(failed, 25, everything)).toEqual({
      ...rest,
      lastError: failed.lastError,
    });
  });

  it("keeps what's stored when the data isn't known or needn't be checked", () => {
    expect(shownBackupState(backedUp, 20, undefined)).toBe(backedUp);
    expect(shownBackupState(pausedAt20, 20, everything)).toBe(pausedAt20);
  });
});

describe('deriveStatus with the games on the phone', () => {
  it('shows the pause the next automatic upload would be held back for', () => {
    expect(status(backedUp, 20, erased)).toMatchObject({
      state: 'paused-shrink',
      pendingChanges: true,
      shrink: { backedUpGames: 4, missingGames: 4 },
    });
    // Even while that upload would wait for signal or a retry: it would be held back then.
    expect(status(backedUp, 20, erased, { ...idle, online: false }).state).toBe('paused-shrink');
    expect(
      status({ ...backedUp, lastError: { ...shrinkError, kind: 'server-busy' } }, 20, erased).state,
    ).toBe('paused-shrink');
  });

  it('keeps showing it while an automatic upload checks it, not a forced one', () => {
    expect(status(backedUp, 20, erased, { ...idle, uploading: true }).state).toBe('paused-shrink');
    expect(status(backedUp, 20, erased, { ...idle, uploading: true, forced: true }).state).toBe(
      'backing-up',
    );
  });

  it('shows changes waiting, not a pause, once the games are back', () => {
    const shown = status(pausedAt20, 25, everything);
    expect(shown).toMatchObject({ state: 'idle', pendingChanges: true, lastSuccessAt: 11 });
    expect(shown).not.toHaveProperty('shrink');
    expect(shown).not.toHaveProperty('lastError');
    expect(status(pausedAt20, 25, everything, { ...idle, uploading: true }).state).toBe(
      'backing-up',
    );
  });

  it('shows the stored pause for the data it checked', () => {
    expect(status(pausedAt20, 20, undefined)).toMatchObject({
      state: 'paused-shrink',
      shrink: { backedUpGames: 4, missingGames: 4 },
      lastError: shrinkError,
    });
  });
});
