import { describe, expect, it } from 'vitest';
import type { CloudBackupStatus } from '@/data/backup/cloudBackup';
import { errorMessage, newBackupLimitMessage } from '@/data/backup/errors';
import { buildRealData } from '@/test/backupHarness';
import {
  backUpAnywayMessage,
  backupCoverage,
  backupKeepsUp,
  cloudBackupSummary,
  codeFromTyped,
  describeStatus,
  eraseCloudNote,
  formatBackupTime,
  formatWhen,
  otherDeviceMessage,
  shareableCode,
  shrinkMessage,
  timeAgo,
  withoutWaits,
} from './cloudBackupText';

/** Sep 28, 2026, 7:42 PM local time. */
const NOW = new Date(2026, 8, 28, 19, 42).getTime();

/** Dates and times never break across lines: they're joined by no-break spaces. */
const nb = (text: string) => text.replace(/ /g, '\u00a0');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const on = (status: Partial<CloudBackupStatus>): CloudBackupStatus => ({
  available: true,
  enabled: true,
  state: 'idle',
  pendingChanges: false,
  ...status,
});

describe('timeAgo', () => {
  it.each([
    [0, 'just now'],
    [59_999, 'just now'],
    [MINUTE, 'a minute ago'],
    [2 * MINUTE + 59_000, '2 minutes ago'],
    [59 * MINUTE, '59 minutes ago'],
    [HOUR, 'an hour ago'],
    [23 * HOUR + 59 * MINUTE, '23 hours ago'],
    [24 * HOUR, `on ${nb('Sep 27')}`],
    // A clock that moved back never makes it "in the future".
    [-5 * MINUTE, 'just now'],
  ])('%i ms ago is "%s"', (elapsed, text) => {
    expect(timeAgo(NOW - elapsed, NOW)).toBe(text);
  });

  it('names the year of a day in another year', () => {
    expect(timeAgo(new Date(2025, 11, 30, 9).getTime(), NOW)).toBe(`on ${nb('Dec 30, 2025')}`);
  });
});

describe('formatWhen', () => {
  it('gives the time today, and the day too otherwise', () => {
    expect(formatWhen(new Date(2026, 8, 28, 19, 45).getTime(), NOW)).toBe(`at ${nb('7:45 PM')}`);
    expect(formatWhen(new Date(2026, 8, 29, 7, 5).getTime(), NOW)).toBe(
      `on ${nb('Sep 29')} at ${nb('7:05 AM')}`,
    );
  });
});

describe('cloudBackupSummary', () => {
  it('says when the phone made the backup, its games and the player', () => {
    const file = buildRealData();
    expect(cloudBackupSummary({ exportedAt: NOW, file })).toEqual([
      'Backup from Sep 28, 2026',
      nb('7:42 PM'),
      '10 games',
      'Ava #12',
    ]);
    expect(formatBackupTime(NOW)).toBe(`${nb('Sep 28, 2026')}, ${nb('7:42 PM')}`);
    expect(
      cloudBackupSummary({ exportedAt: NOW, file: { ...file, players: [], games: [] } }),
    ).toEqual(['Backup from Sep 28, 2026', nb('7:42 PM'), 'No games']);
  });
});

describe('describeStatus', () => {
  it('says when it last backed up, and when newer changes are waiting', () => {
    expect(describeStatus(on({ lastSuccessAt: NOW - 2 * MINUTE }), NOW)).toEqual({
      title: 'Backed up 2 minutes ago',
      detail: undefined,
      tone: 'ok',
    });
    expect(
      describeStatus(on({ lastSuccessAt: NOW - 2 * MINUTE, pendingChanges: true }), NOW),
    ).toMatchObject({
      title: 'Backed up 2 minutes ago',
      detail: 'Newer changes will back up soon.',
    });
    expect(describeStatus(on({ pendingChanges: true }), NOW)).toEqual({
      title: 'Not backed up yet',
      detail: 'Will back up soon.',
      tone: 'waiting',
    });
  });

  it('shows a backup running, and one waiting for signal', () => {
    expect(describeStatus(on({ state: 'backing-up', lastSuccessAt: NOW - HOUR }), NOW)).toEqual({
      title: 'Backing up…',
      detail: 'Last backed up an hour ago.',
      tone: 'busy',
    });
    expect(describeStatus(on({ state: 'backing-up' }), NOW).detail).toBeUndefined();
    const offline = { online: false };
    expect(
      describeStatus(
        on({ state: 'waiting-for-signal', lastSuccessAt: NOW - 3 * HOUR }),
        NOW,
        offline,
      ),
    ).toEqual({
      title: 'Waiting for signal: will back up automatically',
      detail: 'Your stats are safe on this phone. Last backed up 3 hours ago.',
      tone: 'offline',
    });
    expect(describeStatus(on({ state: 'waiting-for-signal' }), NOW, offline).detail).toBe(
      'Your stats are safe on this phone. Not backed up yet.',
    );
  });

  it("doesn't blame the signal when the phone has one and the server can't be reached", () => {
    expect(
      describeStatus(on({ state: 'waiting-for-signal', lastSuccessAt: NOW - 3 * HOUR }), NOW, {
        online: true,
      }),
    ).toEqual({
      title: "Can't reach the backup server right now",
      detail:
        'Backup will try again. Your stats are safe on this phone. Last backed up 3 hours ago.',
      tone: 'offline',
    });
    // Online is what the phone says when it can't tell.
    expect(describeStatus(on({ state: 'waiting-for-signal' }), NOW)).toMatchObject({
      title: "Can't reach the backup server right now",
      detail: 'Backup will try again. Your stats are safe on this phone. Not backed up yet.',
    });
  });

  it("gives the engine's message and when it will try again after a failure", () => {
    const lastError = { kind: 'server-busy', message: 'The backup server is busy.', at: NOW };
    expect(
      describeStatus(on({ state: 'error', lastError, nextAttemptAt: NOW + 5 * MINUTE }), NOW),
    ).toEqual({
      title: `Backup will try again at ${nb('7:47 PM')}`,
      detail: 'The backup server is busy.',
      tone: 'attention',
    });
    // Due already (e.g. the app was asleep): it tries again as soon as it can.
    expect(
      describeStatus(on({ state: 'error', lastError, nextAttemptAt: NOW - MINUTE }), NOW).title,
    ).toBe('Backup will try again soon');
  });

  it("leaves out the stored message's waits, which go stale: the title says when", () => {
    const failedAt = NOW - 4 * MINUTE;
    const busy = {
      kind: 'server-busy',
      message: errorMessage('server-busy', 'backup', 5 * MINUTE),
      at: failedAt,
    };
    expect(busy.message).toBe('The backup server is busy. Hoop Stats will try again in 5 minutes.');
    // Four minutes later, and after the time has passed.
    for (const now of [NOW, NOW + 2 * MINUTE]) {
      const line = describeStatus(
        on({ state: 'error', lastError: busy, nextAttemptAt: failedAt + 5 * MINUTE }),
        now,
      );
      expect(line.detail).toBe('The backup server is busy.');
    }
    const limit = newBackupLimitMessage(3 * HOUR);
    expect(withoutWaits(limit)).toBe("The backup server can't take a new backup right now.");
    expect(withoutWaits(errorMessage('rate-limited', 'backup', 30_000))).toBe(
      'The backup server is busy.',
    );
    // A message without a counted wait stays whole.
    const full = errorMessage('server-full', 'backup');
    expect(withoutWaits(full)).toBe(full);
    expect(withoutWaits(undefined)).toBeUndefined();
  });

  it('explains a stop or a pause', () => {
    const lastError = { kind: 'too-large', message: 'Your stats are too big.', at: NOW };
    expect(describeStatus(on({ state: 'needs-attention', lastError }), NOW)).toEqual({
      title: 'Backup stopped',
      detail: 'Your stats are too big.',
      tone: 'attention',
    });
    expect(
      describeStatus(
        on({ state: 'paused-shrink', shrink: { backedUpGames: 10, missingGames: 10 } }),
        NOW,
      ),
    ).toEqual({
      title: 'Backup paused',
      detail:
        'None of the 10 games in your last backup are on this phone, so automatic backup is paused to keep that backup safe.',
      tone: 'attention',
    });
    expect(
      describeStatus(
        on({ state: 'paused-other-device', otherDevice: { backedUpAt: NOW - 5 * MINUTE } }),
        NOW,
      ),
    ).toEqual({
      title: 'Backup paused',
      detail:
        'Another phone backed up with this backup code 5 minutes ago, so this phone stopped backing up to keep from replacing that backup.',
      tone: 'attention',
    });
  });
});

describe('shrinkMessage', () => {
  it.each([
    [{ backedUpGames: 1, missingGames: 1 }, "The game in your last backup isn't on this phone"],
    [
      { backedUpGames: 2, missingGames: 2 },
      'Neither of the 2 games in your last backup is on this phone',
    ],
    [
      { backedUpGames: 12, missingGames: 4 },
      "4 of the 12 games in your last backup aren't on this phone",
    ],
    [
      { backedUpGames: 3, missingGames: 1 },
      "1 of the 3 games in your last backup isn't on this phone",
    ],
    [{ backedUpGames: 5, missingGames: 0 }, 'Your last backup has stats but this phone has none'],
    [undefined, "Some games in your last backup aren't on this phone"],
  ])('%o', (shrink, start) => {
    expect(shrinkMessage(shrink)).toBe(
      `${start}, so automatic backup is paused to keep that backup safe.`,
    );
  });
});

describe('otherDeviceMessage', () => {
  it('says when the other phone backed up, if the server said', () => {
    expect(otherDeviceMessage({}, NOW)).toBe(
      'Another phone backed up with this backup code since this phone last did, so this phone stopped backing up to keep from replacing that backup.',
    );
  });
});

describe('backUpAnywayMessage', () => {
  it('says what the backup loses and what the server keeps', () => {
    const keeps =
      'Older backups stay available for a while: the server keeps your last 20, plus one for each of the last 180 days you backed up.';
    expect(backUpAnywayMessage({ backedUpGames: 10, missingGames: 10 })).toBe(
      `This replaces your online backup with what's on this phone, without the 10 missing games. ${keeps}`,
    );
    expect(backUpAnywayMessage({ backedUpGames: 3, missingGames: 1 })).toBe(
      `This replaces your online backup with what's on this phone, without the missing game. ${keeps}`,
    );
    expect(backUpAnywayMessage({ backedUpGames: 3, missingGames: 0 })).toBe(
      `This replaces your online backup with what's on this phone. ${keeps}`,
    );
  });
});

describe('sharing the code', () => {
  it('labels a shared code, and reads the label back off a pasted one', () => {
    const code = '7K3M-9QXA-B2CD-EF45-GH67-JK89-MN0P';
    expect(shareableCode(code)).toBe(`Hoop Stats backup code: ${code}`);
    expect(codeFromTyped(shareableCode(code))).toBe(code);
    expect(codeFromTyped(' hoop stats backup code 7k3m 9qxa ')).toBe('7k3m 9qxa');
    expect(codeFromTyped(code)).toBe(code);
  });
});

describe('backupCoverage', () => {
  const code = '7K3M-9QXA-B2CD-EF45-GH67-JK89-MN0P';
  const backedUp = { lastSuccessAt: NOW - HOUR };
  const error = (kind: string) => ({ kind, message: 'Stopped.', at: NOW });

  it('calls a backup complete only when it has everything', () => {
    expect(backupCoverage(on(backedUp), code)).toEqual({ kind: 'complete' });
    // Nothing waiting: a failed "Back up now" or no signal don't change that.
    expect(backupCoverage(on({ ...backedUp, state: 'error' }), code).kind).toBe('complete');
    expect(backupCoverage(on({ ...backedUp, state: 'waiting-for-signal' }), code).kind).toBe(
      'complete',
    );
    expect(backupCoverage(on({ ...backedUp, pendingChanges: true }), code)).toEqual({
      kind: 'behind',
      lastSuccessAt: NOW - HOUR,
      paused: false,
    });
    for (const state of ['paused-shrink', 'paused-other-device'] as const) {
      expect(backupCoverage(on({ ...backedUp, state }), code)).toEqual({
        kind: 'behind',
        lastSuccessAt: NOW - HOUR,
        paused: true,
      });
    }
    expect(backupCoverage(on({ pendingChanges: true }), code)).toEqual({ kind: 'never' });
  });

  it('tells a deleted online backup from other stops, and off from none', () => {
    const stopped = { ...backedUp, state: 'needs-attention' } as const;
    expect(backupCoverage(on({ ...stopped, lastError: error('account-deleted') }), code)).toEqual({
      kind: 'deleted',
    });
    expect(backupCoverage(on({ ...stopped, lastError: error('too-large') }), code)).toEqual({
      kind: 'stopped',
    });
    const off = { available: true, enabled: false, state: 'idle', pendingChanges: false } as const;
    expect(backupCoverage(off, code)).toEqual({ kind: 'off' });
    expect(backupCoverage(off, null)).toEqual({ kind: 'none' });
    expect(backupCoverage({ ...off, available: false }, code)).toEqual({ kind: 'none' });
  });

  it('keeps up while on and working, even with changes waiting for signal', () => {
    expect(backupKeepsUp({ kind: 'complete' })).toBe(true);
    expect(backupKeepsUp({ kind: 'behind', lastSuccessAt: NOW, paused: false })).toBe(true);
    expect(backupKeepsUp({ kind: 'behind', lastSuccessAt: NOW, paused: true })).toBe(false);
    for (const kind of ['never', 'deleted', 'stopped', 'off', 'none'] as const) {
      expect(backupKeepsUp({ kind })).toBe(false);
    }
  });
});

describe('eraseCloudNote', () => {
  it('says what the online backup has of what "Erase all data" deletes', () => {
    expect(eraseCloudNote({ kind: 'none' }, NOW)).toBe('');
    expect(eraseCloudNote({ kind: 'never' }, NOW)).toBe("This phone hasn't backed up online yet.");
    expect(eraseCloudNote({ kind: 'stopped' }, NOW)).toBe(
      "Cloud backup has stopped, so your latest stats aren't backed up online.",
    );
    expect(
      eraseCloudNote({ kind: 'behind', lastSuccessAt: NOW - 3 * HOUR, paused: true }, NOW),
    ).toBe(
      "This phone last backed up 3 hours ago, so anything changed since then isn't in your online backup.",
    );
  });
});
