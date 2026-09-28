import { describe, expect, it, vi } from 'vitest';
import {
  buildRealData,
  createEngineHarness,
  realGameId,
  REAL_LIVE_GAME_ID,
  TEST_API_URL,
  TEST_START,
  type EngineHarness,
} from '@/test/backupHarness';
import { resetDatabase } from '@/test/db';
import { isDemoGameId, seedDemoData } from '../demo';
import * as repo from '../repo';
import {
  createGame,
  deleteGame,
  endGame,
  getLastChangeAt,
  getSettings,
  listGames,
  recordStat,
  savePlayer,
  updateSettings,
} from '../repo';
import { clearAllData, exportAll, importAll } from '../transfer';
import { createBackupApi } from './api';
import { generateBackupCode, parseBackupCode } from './code';
import { BackupEngine, observeDatabase, readObservation, type BackupObservation } from './engine';
import { deriveBackupKeys } from './keys';
import { decryptSnapshot, encryptSnapshot } from './snapshot';
import { loadBackupState, turnOnBackupState } from './state';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Ten final games of the parent's own (and a live one, if asked). */
async function seedReal(options: { liveGame?: boolean } = {}) {
  await importAll(buildRealData(options), 'replace');
}

/** Any data change that keeps the games (flips a setting). */
async function change(h: EngineHarness) {
  await updateSettings({ shotChart: !(await getSettings()).shotChart });
  await h.notify();
}

/** A finished game of the parent's own, with `stats` stats. */
async function playGame(n: number, stats = 12) {
  const game = await createGame({
    opponent: `Opponent ${n}`,
    date: '2026-10-01',
    periodFormat: 'quarters',
  });
  for (let i = 0; i < stats; i += 1) await recordStat(game.id, i % 2 ? 'dreb' : 'fg2_made');
  await endGame(game.id, { teamScore: 40, opponentScore: 30 });
  return game;
}

/** Lets promise callbacks (e.g. after an online event) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Turns backup on (the first upload goes at once) and starts the scheduler, then lets
 * its startup check run (it finds nothing new): tests start 10 s after that upload.
 */
async function turnOn(h: EngineHarness): Promise<string> {
  const code = await h.engine.enable();
  await h.settle();
  h.engine.start();
  await h.notify();
  await h.advance(10 * SECOND);
  expect(h.server.putCount).toBe(1);
  return code;
}

/** Another phone with the same code uploads its own snapshot. */
async function uploadFromAnotherPhone(h: EngineHarness, code: string) {
  const keys = await deriveBackupKeys(parseBackupCode(code));
  const api = createBackupApi({ baseUrl: 'https://backup.hoop-stats.test', fetch: h.server.fetch });
  const snapshot = await encryptSnapshot(buildRealData({ today: '2026-10-05' }), keys);
  const uploaded = await api.upload(keys, snapshot);
  if (!uploaded.ok) throw new Error(uploaded.error.kind);
  return uploaded.value;
}

describe('backup scheduler', () => {
  it('does nothing while backup is off', async () => {
    const h = createEngineHarness();
    await seedReal();
    h.engine.start();
    await h.notify();
    await change(h);
    await h.advance(30 * MINUTE);
    expect(h.server.requests).toEqual([]);
    expect(await h.engine.getStatus()).toMatchObject({ enabled: false, state: 'idle' });
  });

  it('uploads an encrypted snapshot as soon as backup is turned on', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);

    expect(h.server.uploads).toHaveLength(1);
    const keys = await deriveBackupKeys(parseBackupCode(code));
    const upload = h.server.uploads[0];
    expect(upload?.accountId).toBe(keys.accountId);
    const { exportedAt: _, ...uploaded } = await decryptSnapshot(upload!.bytes, keys);
    const { exportedAt: __, ...current } = await exportAll();
    expect(uploaded).toEqual(current);

    expect(await loadBackupState()).toEqual({
      code,
      enabledAt: TEST_START,
      lastSuccessAt: TEST_START,
      lastUploadedChangeAt: await getLastChangeAt(),
      backedUpGameIds: current.games.map((game) => game.id),
      backedUpEventCount: current.events.length,
      lastVersion: upload?.version,
    });
    expect(await h.engine.getStatus()).toEqual({
      available: true,
      enabled: true,
      state: 'idle',
      lastSuccessAt: TEST_START,
      pendingChanges: false,
    });
  });

  it('backs up changes made while the app was closed, shortly after it starts', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOnBackupState(generateBackupCode(), 1);
    h.engine.start();
    await h.notify();
    await h.advance(3 * SECOND - 1);
    expect(h.server.putCount).toBe(0);
    await h.advance(1);
    expect(h.server.putCount).toBe(1);

    // Starting again with nothing new uploads nothing.
    h.engine.stop();
    h.engine.start();
    await h.notify();
    await h.advance(10 * MINUTE);
    expect(h.server.putCount).toBe(1);
  });

  it('waits for 20 quiet seconds, but never more than a minute', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    await change(h);
    await h.advance(20 * SECOND - 1);
    expect(h.server.putCount).toBe(1);
    await h.advance(1);
    expect(h.server.putCount).toBe(2);

    // A change every 10 s: the upload goes a minute after the first one.
    await h.advance(MINUTE);
    for (let i = 0; i < 6; i += 1) {
      await change(h);
      await h.advance(10 * SECOND - (i === 5 ? 1 : 0));
    }
    expect(h.server.putCount).toBe(2);
    await h.advance(1);
    expect(h.server.putCount).toBe(3);
    expect((await loadBackupState())?.lastUploadedChangeAt).toBe(await getLastChangeAt());
  });

  it('during a live game, uploads in a quiet spell between taps (or every 5 minutes)', async () => {
    const h = createEngineHarness();
    await seedReal({ liveGame: true });
    await turnOn(h);

    // A burst of taps, then 20 s without one: the upload goes in that quiet spell
    // (and no sooner than a minute after the last upload, at TEST_START).
    for (let i = 0; i < 5; i += 1) {
      await recordStat(REAL_LIVE_GAME_ID, 'ast');
      await h.notify();
      await h.advance(5 * SECOND);
    }
    // Now at 35 s: the last tap was at 30 s, so the quiet spell ends at 50 s, but the
    // minute since the last upload runs to 60 s.
    await h.advance(25 * SECOND - 1);
    expect(h.server.putCount).toBe(1);
    await h.advance(1);
    expect(h.server.putCount).toBe(2);

    // Steady tapping, never 20 s apart: nothing goes up for 5 minutes, then it does.
    const burstStart = h.clock.now();
    while (h.clock.now() < burstStart + 5 * MINUTE - 10 * SECOND) {
      await recordStat(REAL_LIVE_GAME_ID, 'dreb');
      await h.notify();
      await h.advance(10 * SECOND);
    }
    expect(h.server.putCount).toBe(2);
    await h.advance(10 * SECOND);
    expect(h.server.putCount).toBe(3);

    // The game ends: backed up 2 s later.
    await h.advance(30 * SECOND);
    await endGame(REAL_LIVE_GAME_ID, { teamScore: 50, opponentScore: 40 });
    await h.notify();
    await h.advance(2 * SECOND - 1);
    expect(h.server.putCount).toBe(3);
    await h.advance(1);
    expect(h.server.putCount).toBe(4);
  });

  it('skips the upload when nothing changed', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    h.environment.emit('visible');
    await flush();
    await h.advance(MINUTE);
    h.environment.emit('online');
    await flush();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(1);
  });

  it('runs one upload at a time, and uploads changes made meanwhile afterwards', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    const release = h.server.hold();
    await change(h);
    await h.clock.advance(20 * SECOND);
    await vi.waitFor(() => expect(h.server.inFlight).toBe(1));
    expect((await h.engine.getStatus()).state).toBe('backing-up');

    await change(h);
    await h.clock.advance(5 * MINUTE);
    expect(h.server.inFlight).toBe(1);

    release();
    await h.settle();
    expect(h.server.putCount).toBe(2);
    await h.advance(0);
    expect(h.server.putCount).toBe(3);
    expect(h.server.maxInFlight).toBe(1);
    expect((await loadBackupState())?.lastUploadedChangeAt).toBe(await getLastChangeAt());
  });

  it('waits for a connection, then uploads as soon as it is back', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    h.environment.emit('offline');
    await change(h);
    await h.advance(10 * MINUTE);
    expect(h.server.putCount).toBe(1);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'waiting-for-signal',
      pendingChanges: true,
    });

    h.environment.emit('online');
    await flush();
    await h.advance(0);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('backs off 1, 2, 5, 15 and 30 minutes after failures, then recovers', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    for (let i = 0; i < 7; i += 1) {
      h.server.failNext({ status: 500, error: 'internal_error', method: 'PUT' });
    }

    await change(h);
    await h.advance(20 * SECOND);
    expect(h.server.putCount).toBe(2);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'error',
      nextAttemptAt: h.clock.now() + MINUTE,
      lastError: {
        kind: 'server-error',
        message: 'The backup server had a problem. Hoop Stats will try again soon.',
      },
    });

    for (const minutes of [1, 2, 5, 15, 30, 30]) {
      const before = h.server.putCount;
      await h.advance(minutes * MINUTE - 1);
      expect(h.server.putCount).toBe(before);
      await h.advance(1);
      expect(h.server.putCount).toBe(before + 1);
    }
    // The 8th upload succeeds.
    await h.advance(30 * MINUTE);
    expect(h.server.putCount).toBe(9);
    const state = await loadBackupState();
    expect(state).toMatchObject({ lastSuccessAt: h.clock.now() });
    expect(state).not.toHaveProperty('lastError');
    expect(state).not.toHaveProperty('failures');
    expect(state).not.toHaveProperty('nextAttemptAt');
  });

  it('waits as long as the server asks (Retry-After), and says how long', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    h.server.failNext({ status: 503, error: 'server_busy', retryAfterSeconds: 300, method: 'PUT' });
    h.server.failNext({
      status: 429,
      error: 'rate_limited',
      retryAfterSeconds: 20 * 3600,
      method: 'PUT',
    });
    await change(h);
    await h.advance(20 * SECOND);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).lastError?.message).toBe(
      'The backup server is busy. Hoop Stats will try again in 5 minutes.',
    );
    await h.advance(5 * MINUTE - 1);
    expect(h.server.putCount).toBe(2);
    await h.advance(1);
    expect(h.server.putCount).toBe(3);
    expect(await h.engine.getStatus()).toMatchObject({
      nextAttemptAt: h.clock.now() + 20 * HOUR,
      lastError: {
        kind: 'rate-limited',
        message: 'The backup server is busy. Hoop Stats will try again in 20 hours.',
      },
    });
    await h.advance(20 * HOUR);
    expect(h.server.putCount).toBe(4);
  });

  it("retries a lost connection as soon as there's signal, not after the backoff", async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    h.server.networkDown = true;
    await change(h);
    await h.advance(20 * SECOND);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'waiting-for-signal',
      lastError: { kind: 'network' },
    });

    h.server.networkDown = false;
    h.environment.emit('visible');
    await vi.waitFor(async () =>
      expect(await loadBackupState()).not.toHaveProperty('nextAttemptAt'),
    );
    await flush();
    await h.advance(10 * SECOND);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('sends waiting changes when the app is hidden, even during a backoff', async () => {
    const h = createEngineHarness();
    await seedReal({ liveGame: true });
    await turnOn(h);

    // A spotty connection: three failures in a row, a 5-minute backoff.
    h.server.networkDown = true;
    await recordStat(REAL_LIVE_GAME_ID, 'stl');
    await h.notify();
    await h.advance(MINUTE);
    await h.advance(MINUTE);
    await h.advance(2 * MINUTE);
    expect(await loadBackupState()).toMatchObject({ failures: 3 });
    h.server.networkDown = false;

    // Signal is back; the parent records one more stat and locks the phone.
    await recordStat(REAL_LIVE_GAME_ID, 'ast');
    await h.notify();
    const puts = h.server.putCount;
    h.environment.emit('hidden');
    await vi.waitFor(async () =>
      expect(await loadBackupState()).not.toHaveProperty('nextAttemptAt'),
    );
    await flush();
    await h.advance(0);
    expect(h.server.putCount).toBe(puts + 1);
    expect((await loadBackupState())?.lastUploadedChangeAt).toBe(await getLastChangeAt());
  });

  it.each([
    [401, 'unauthorized', 'code-rejected', "doesn't accept this backup code anymore"],
    [409, 'account_deleted', 'cloud-deleted', 'Your cloud backup was deleted'],
    [413, 'payload_too_large', 'too-large', 'too big for cloud backup'],
  ])('stops after a %i until the parent acts', async (status, error, paused, message) => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    h.server.failNext({ status, error, method: 'PUT' });
    await change(h);
    await h.advance(20 * SECOND);
    expect(await loadBackupState()).toMatchObject({ paused });
    const status_ = await h.engine.getStatus();
    expect(status_.state).toBe('needs-attention');
    expect(status_.lastError?.message).toContain(message);

    await change(h);
    await h.advance(2 * HOUR);
    expect(h.server.putCount).toBe(2);

    // "Back up now" tries again, and a success resumes automatic backup.
    const result = await h.engine.backUpNow();
    expect(result.ok).toBe(true);
    expect(await loadBackupState()).not.toHaveProperty('paused');
  });

  it("doesn't send a snapshot bigger than the server takes", async () => {
    const h = createEngineHarness({ maxUploadBytes: 100 });
    await seedReal();
    await h.engine.enable();
    await h.settle();
    expect(h.server.putCount).toBe(0);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'needs-attention',
      lastError: {
        kind: 'too-large',
        message: 'Your stats are too big for cloud backup. Save a backup file instead.',
      },
    });
  });

  it("blames the phone, not the server, when it can't encrypt", async () => {
    const h = createEngineHarness();
    await seedReal();
    const encrypt = vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValue(new Error('No crypto'));
    await h.engine.enable();
    await h.settle();
    encrypt.mockRestore();
    expect(h.server.putCount).toBe(0);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'error',
      nextAttemptAt: TEST_START + MINUTE,
      lastError: {
        kind: 'unexpected',
        message:
          'Something went wrong on this phone while backing up. Your stats are safe, and Hoop Stats will try again soon.',
      },
    });
  });

  it('keeps retrying, with a clear message, while the server is full', async () => {
    const h = createEngineHarness();
    await seedReal();
    h.server.failNext({ status: 507, error: 'account_limit_reached', method: 'PUT' });
    await h.engine.enable();
    await h.settle();
    h.engine.start();
    await h.notify();
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'error',
      nextAttemptAt: TEST_START + MINUTE,
      lastError: { kind: 'account-limit', message: expect.stringContaining('full') as string },
    });
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('starts once, and stops cleanly', async () => {
    const h = createEngineHarness();
    await turnOnBackupState(generateBackupCode(), 1);
    h.engine.start();
    h.engine.start();
    await h.notify();
    expect(h.subscriptions()).toBe(1);
    expect(h.environment.listenerCount).toBe(1);
    expect(h.clock.nextTimerAt()).toBe(TEST_START + 3 * SECOND);

    h.engine.stop();
    expect(h.environment.listenerCount).toBe(0);
    expect(h.clock.nextTimerAt()).toBeUndefined();
  });

  it('is unavailable without a backup server', async () => {
    const h = createEngineHarness({ apiUrl: () => undefined });
    expect(h.engine.isAvailable()).toBe(false);
    h.engine.start();
    expect(h.subscriptions()).toBe(0);
    await expect(h.engine.enable()).rejects.toThrow(
      "Cloud backup isn't available in this version of Hoop Stats.",
    );
    expect(await h.engine.backUpNow()).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(await loadBackupState()).toBeUndefined();
  });
});

describe('shrink guard', () => {
  it('never lets an erased phone replace the backup without asking', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    await clearAllData();
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(1);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'paused-shrink',
      shrink: { backedUpGames: 10, missingGames: 10 },
      lastError: {
        kind: 'shrink',
        message:
          "Some games in your last backup aren't on this phone, so automatic backup is paused to keep that backup safe.",
      },
    });

    // A change that doesn't bring the games back: still nothing goes up, even when
    // asked without force, and nothing is sent to the server to check.
    const requests = h.server.requests.length;
    await change(h);
    await h.advance(MINUTE);
    expect(h.server.requests).toHaveLength(requests);
    const refused = await h.engine.backUpNow();
    expect(!refused.ok && refused.error.kind).toBe('shrink');
    expect(h.server.putCount).toBe(1);

    // "Back up anyway": the erased data becomes the new baseline.
    const forced = await h.engine.backUpNow({ force: true });
    expect(forced).toMatchObject({ ok: true, value: { games: 0 } });
    expect(await loadBackupState()).toMatchObject({ backedUpGameIds: [] });
    expect(await loadBackupState()).not.toHaveProperty('paused');
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it("doesn't count new games in place of erased ones", async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    await clearAllData();
    await h.notify();
    await h.advance(MINUTE);

    await savePlayer({ name: 'Maya' });
    for (let n = 1; n <= 12; n += 1) {
      await playGame(n);
      await h.notify();
      await h.advance(HOUR);
    }
    expect(h.server.putCount).toBe(1);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'paused-shrink',
      shrink: { backedUpGames: 10, missingGames: 10 },
    });
  });

  it('resumes by itself once the games are back (e.g. after a restore)', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    await clearAllData();
    await h.notify();
    await h.advance(MINUTE);
    expect((await h.engine.getStatus()).state).toBe('paused-shrink');

    await seedReal();
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('holds back losing half the games (3 or more), not fewer', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    await deleteGame(realGameId(1));
    await deleteGame(realGameId(2));
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);

    for (const n of [3, 4, 5, 6]) await deleteGame(realGameId(n));
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'paused-shrink',
      shrink: { backedUpGames: 8, missingGames: 4 },
    });
  });

  it('lets a new season grow past the old one while its games are still there', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    for (let n = 1; n <= 12; n += 1) {
      await playGame(n);
      await h.notify();
      await h.advance(HOUR);
    }
    expect(h.server.putCount).toBe(13);
    expect((await loadBackupState())?.backedUpGameIds).toHaveLength(22);
  });

  it('ignores sample games: removing them never pauses the backup', async () => {
    const h = createEngineHarness();
    // "Try it with sample data", then cloud backup is turned on.
    await seedDemoData({ force: true, keepSettings: true });
    await turnOn(h);
    expect(await loadBackupState()).toMatchObject({ backedUpGameIds: [], backedUpEventCount: 0 });

    // "Remove sample games", then five games of the parent's own.
    for (const game of await listGames()) if (isDemoGameId(game.id)) await deleteGame(game.id);
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    await savePlayer({ name: 'Maya', jerseyNumber: '4' });
    for (let n = 1; n <= 5; n += 1) {
      await playGame(n);
      await h.notify();
      await h.advance(HOUR);
    }
    expect(h.server.putCount).toBe(7);
    expect(await h.engine.getStatus()).toMatchObject({ state: 'idle', pendingChanges: false });
  });

  it("won't let sample data replace the backup of an erased phone", async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    await clearAllData();
    await h.notify();
    await h.advance(MINUTE);
    expect((await h.engine.getStatus()).state).toBe('paused-shrink');

    // The phone looks new again, so Settings offers "Try it with sample data".
    await seedDemoData({ force: true, keepSettings: true });
    await h.notify();
    await h.advance(HOUR);
    expect(h.server.putCount).toBe(1);
    expect((await h.engine.getStatus()).state).toBe('paused-shrink');
    const keys = await deriveBackupKeys(parseBackupCode(code));
    const latest = await decryptSnapshot(h.server.uploads.at(-1)!.bytes, keys);
    expect(latest.games.some((game) => isDemoGameId(game.id))).toBe(false);
  });
});

describe('another phone with the same code', () => {
  it('pauses instead of replacing its newer backup, until forced', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    const theirs = await uploadFromAnotherPhone(h, code);

    await change(h);
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    expect(h.server.uploads.at(-1)?.version).toBe(theirs.version);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'paused-other-device',
      otherDevice: { backedUpAt: theirs.createdAt },
      lastError: {
        kind: 'other-device',
        message:
          'Another phone has backed up with this backup code since this phone did, so this phone stopped backing up to keep from replacing that backup.',
      },
    });

    // Automatic backup stays paused; asking without force gets the same answer.
    await change(h);
    await h.advance(HOUR);
    expect(h.server.putCount).toBe(2);
    const refused = await h.engine.backUpNow();
    expect(!refused.ok && refused.error.kind).toBe('other-device');

    const forced = await h.engine.backUpNow({ force: true });
    expect(forced.ok).toBe(true);
    expect(h.server.putCount).toBe(3);
    expect((await h.engine.getStatus()).state).toBe('idle');
    // From then on, this phone's own uploads pass the check again.
    await change(h);
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(4);
  });

  it('stops (and never re-creates it) when the cloud copy was deleted elsewhere', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    const keys = await deriveBackupKeys(parseBackupCode(code));
    const api = createBackupApi({
      baseUrl: 'https://backup.hoop-stats.test',
      fetch: h.server.fetch,
    });
    expect((await api.deleteAll(keys)).ok).toBe(true);

    await change(h);
    await h.advance(MINUTE);
    expect(h.server.accounts.size).toBe(0);
    expect(h.server.putCount).toBe(1);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'needs-attention',
      lastError: {
        kind: 'account-deleted',
        message: expect.stringContaining('was deleted') as string,
      },
    });
    await change(h);
    await h.advance(HOUR);
    expect(h.server.accounts.size).toBe(0);

    // The parent can start a new cloud copy on purpose.
    expect((await h.engine.backUpNow()).ok).toBe(true);
    expect(h.server.accounts.size).toBe(1);
  });

  it("knows its own upload whose answer was lost from another phone's", async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    h.server.loseNextAnswer = 'PUT';
    await change(h);
    await h.advance(MINUTE);
    expect(h.server.uploads).toHaveLength(2);
    expect(await loadBackupState()).toMatchObject({
      lastError: { kind: 'network' },
      pendingUploadSize: h.server.uploads[1]?.bytes.byteLength,
    });

    h.environment.emit('visible');
    await vi.waitFor(async () =>
      expect(await loadBackupState()).not.toHaveProperty('nextAttemptAt'),
    );
    await flush();
    await h.advance(10 * SECOND);
    expect(h.server.putCount).toBe(3);
    expect(await h.engine.getStatus()).toMatchObject({ state: 'idle', pendingChanges: false });
    expect(await loadBackupState()).not.toHaveProperty('pendingUploadSize');
  });
});

describe('turning backup off and on', () => {
  it('keeps the code, so turning on again reuses it and its account', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);

    for (let cycle = 0; cycle < 4; cycle += 1) {
      expect(await h.engine.disable()).toEqual({ ok: true, value: undefined });
      expect(await h.engine.getStatus()).toMatchObject({ enabled: false });
      expect(await h.engine.getCode()).toBe(code);
      await change(h);
      await h.advance(HOUR);
      expect(await h.engine.enable()).toBe(code);
      await h.settle();
    }
    // One account, and each "turn on" backed up the changes made while off.
    expect(h.server.accounts.size).toBe(1);
    expect(h.server.putCount).toBe(5);
    expect(await h.engine.getStatus()).toMatchObject({ enabled: true, state: 'idle' });
  });

  it('forgets the code only after deleting the cloud copy, which needs signal', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);

    h.environment.emit('offline');
    expect(await h.engine.disable({ deleteCloudCopy: true })).toEqual({
      ok: false,
      error: {
        kind: 'offline',
        message:
          "No internet connection, so your cloud backup wasn't deleted. Try again when you're online.",
      },
    });
    expect(await h.engine.getStatus()).toMatchObject({ enabled: true });

    h.environment.emit('online');
    expect(await h.engine.disable({ deleteCloudCopy: true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(h.server.accounts.size).toBe(0);
    expect(await h.engine.getCode()).toBeUndefined();
    expect(await h.engine.enable()).not.toBe(code);

    // A code kept while off can still have its cloud copy deleted.
    await h.settle();
    await h.engine.disable();
    expect((await h.engine.disable({ deleteCloudCopy: true })).ok).toBe(true);
    expect(h.server.accounts.size).toBe(0);
    expect(await h.engine.getCode()).toBeUndefined();

    // Nothing on the server under a code (401) counts as deleted too.
    await h.engine.enable();
    h.server.accounts.clear();
    expect((await h.engine.disable({ deleteCloudCopy: true })).ok).toBe(true);
  });

  it('stops an upload in flight', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    const release = h.server.hold();
    await change(h);
    await h.clock.advance(20 * SECOND);
    await vi.waitFor(() => expect(h.server.inFlight).toBe(1));
    expect(await h.engine.disable()).toEqual({ ok: true, value: undefined });
    release();
    await h.settle();
    expect(await loadBackupState()).toMatchObject({ disabledAt: expect.any(Number) as number });
    expect(h.server.uploads).toHaveLength(1);

    await change(h);
    await h.advance(HOUR);
    expect(h.server.uploads).toHaveLength(1);
    expect(await h.engine.getStatus()).toMatchObject({ enabled: false, state: 'idle' });
  });

  it("stops an upload that hasn't reached the network yet", async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    // Hold the attempt while it derives its keys (a cold cache, as after a relaunch).
    (h.engine as unknown as { keyCache: Map<string, unknown> }).keyCache.clear();
    const importKey = crypto.subtle.importKey.bind(crypto.subtle) as (
      ...args: unknown[]
    ) => Promise<CryptoKey>;
    let reached!: () => void;
    const inKeys = new Promise<void>((resolve) => (reached = resolve));
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const spy = vi.spyOn(crypto.subtle, 'importKey').mockImplementation(async (...args) => {
      if (args[2] === 'HKDF') {
        reached();
        await gate;
      }
      return importKey(...args);
    });
    try {
      const upload = h.engine.backUpNow();
      await inKeys;
      expect((await h.engine.disable()).ok).toBe(true);
      open();
      expect(await upload).toMatchObject({ ok: false, error: { kind: 'aborted' } });
      await h.settle();
    } finally {
      spy.mockRestore();
    }
    // Nothing went out after the first upload (its HEAD check and PUT).
    expect(h.server.requests.map(({ method }) => method)).toEqual(['HEAD', 'PUT']);
  });

  it('keeps waiting changes when "turn off and delete" fails', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    const release = h.server.hold();
    await change(h);
    await h.clock.advance(20 * SECOND);
    await vi.waitFor(() => expect(h.server.inFlight).toBe(1));
    const disabling = h.engine.disable({ deleteCloudCopy: true });
    await vi.waitFor(() => expect(h.server.requests.at(-1)?.method).toBe('DELETE'));
    h.server.networkDown = true;
    release();
    expect((await disabling).ok).toBe(false);
    h.server.networkDown = false;
    await h.settle();

    // Backup is still on and still knows about the change: hiding the app sends it.
    expect(await h.engine.getStatus()).toMatchObject({ enabled: true, pendingChanges: true });
    h.environment.emit('hidden');
    await flush();
    await h.advance(0);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).pendingChanges).toBe(false);
  });

  it('answers "back up now" during a turn-off by what happened', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);

    // The delete fails (no signal to the server), so backup stays on and it backs up.
    h.server.failNext({ status: 503, error: 'server_busy', method: 'DELETE' });
    const disabling = h.engine.disable({ deleteCloudCopy: true });
    const upload = h.engine.backUpNow();
    expect((await disabling).ok).toBe(false);
    expect((await upload).ok).toBe(true);

    // Turned off for real: backing up now says backup is off.
    const turningOff = h.engine.disable();
    const refused = h.engine.backUpNow();
    expect((await turningOff).ok).toBe(true);
    expect(await refused).toMatchObject({ ok: false, error: { kind: 'not-enabled' } });
  });
});

describe('storage failures', () => {
  it('resolve to a result instead of throwing', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    const state = await import('./state');

    const turnOff = vi.spyOn(state, 'turnOffBackupState').mockRejectedValueOnce(new Error('disk'));
    expect(await h.engine.disable()).toEqual({
      ok: false,
      error: {
        kind: 'unexpected',
        message: 'Something went wrong on this phone, so nothing changed. Try again.',
      },
    });
    turnOff.mockRestore();
    expect(await h.engine.getStatus()).toMatchObject({ enabled: true });

    const fetched = await h.engine.fetchBackup(code);
    if (!fetched.ok) throw new Error(fetched.error.message);
    await h.engine.disable();
    const replace = vi.spyOn(state, 'replaceBackupState').mockRejectedValueOnce(new Error('disk'));
    expect(await h.engine.enableWithCode(code, { backup: fetched.value })).toEqual({
      ok: false,
      error: { kind: 'unexpected', message: 'Something went wrong on this phone. Try again.' },
    });
    replace.mockRestore();
    expect(await h.engine.getStatus()).toMatchObject({ enabled: false });
  });

  it('recover from a failed first read on the next visible or online event', async () => {
    await seedReal();
    await turnOnBackupState(generateBackupCode(), 1);
    const liveGame = vi.spyOn(repo, 'getLiveGame').mockRejectedValueOnce(new Error('IDB hiccup'));
    const h = createEngineHarness({ observe: observeDatabase });
    try {
      h.engine.start();
      await vi.waitFor(() => expect(liveGame).toHaveBeenCalled());
      await flush();
      h.environment.emit('visible');
      await flush();
      await h.advance(HOUR);
      expect(h.server.putCount).toBe(1);
      expect((await h.engine.getStatus()).pendingChanges).toBe(false);
    } finally {
      h.engine.stop();
    }
  });
});

describe('observeDatabase', () => {
  it('reports data changes, the live game and the backup state, from any writer', async () => {
    const seen: BackupObservation[] = [];
    const unsubscribe = observeDatabase((observation) => seen.push(observation));
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({ lastChangeAt: undefined, liveGame: false, state: undefined });

      const code = generateBackupCode();
      await turnOnBackupState(code, 1);
      await vi.waitFor(() => expect(seen.at(-1)?.state).toEqual({ code, enabledAt: 1 }));
      await seedReal({ liveGame: true });
      await vi.waitFor(() => expect(seen.at(-1)?.liveGame).toBe(true));
      await endGame(REAL_LIVE_GAME_ID);
      await vi.waitFor(() => expect(seen.at(-1)?.liveGame).toBe(false));
      expect(seen.at(-1)?.lastChangeAt).toBe(await getLastChangeAt());
    } finally {
      unsubscribe();
    }
  });

  it('reads only the backup state after writes while backup is off', async () => {
    const seen: BackupObservation[] = [];
    const unsubscribe = observeDatabase((observation) => seen.push(observation));
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      const lastChange = vi.spyOn(repo, 'getLastChangeAt');
      const liveGame = vi.spyOn(repo, 'getLiveGame');
      await seedReal({ liveGame: true });
      await recordStat(REAL_LIVE_GAME_ID, 'ast');
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(1));
      await flush();
      expect(lastChange).not.toHaveBeenCalled();
      expect(liveGame).not.toHaveBeenCalled();
      expect(seen.at(-1)).toEqual({ lastChangeAt: undefined, liveGame: false, state: undefined });
    } finally {
      unsubscribe();
    }
  });
});

describe('restoring a backup under the same code', () => {
  it.each(['merge', 'replace'] as const)(
    'settles an "another phone" pause by restoring that phone\'s backup (%s)',
    async (mode) => {
      const h = createEngineHarness();
      await seedReal();
      const code = await turnOn(h);
      const theirs = await uploadFromAnotherPhone(h, code);
      await change(h);
      await h.advance(MINUTE);
      expect((await h.engine.getStatus()).state).toBe('paused-other-device');

      const fetched = await h.engine.fetchBackup(code);
      if (!fetched.ok) throw new Error(fetched.error.message);
      await importAll(fetched.value.file, mode);
      expect(await h.engine.enableWithCode(code, { backup: fetched.value })).toEqual({
        ok: true,
        value: undefined,
      });
      await h.settle();
      // Carried on from their backup: its games are the baseline, nothing is paused,
      // and this phone's upload went on top of theirs.
      const state = await loadBackupState();
      for (const field of ['paused', 'otherDevice', 'shrink', 'lastError', 'pendingUploadSize']) {
        expect(state).not.toHaveProperty(field);
      }
      expect(h.server.uploads.at(-2)?.version).toBe(theirs.version);
      expect(h.server.putCount).toBe(3);
      await change(h);
      await h.advance(MINUTE);
      expect(h.server.putCount).toBe(4);
      expect((await h.engine.getStatus()).state).toBe('idle');
    },
  );

  it('carries on from the newest backup after restoring an earlier one', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    await change(h);
    await h.advance(MINUTE);
    await change(h);
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(3);

    // A new phone (nothing stored on it) restores the second-newest backup.
    h.engine.stop();
    await resetDatabase();
    const phone = createEngineHarness({ fetch: h.server.fetch });
    const versions = await phone.engine.listVersions(code);
    if (!versions.ok) throw new Error(versions.error.message);
    const fetched = await phone.engine.fetchBackup(code, { version: versions.value[1]?.version });
    if (!fetched.ok) throw new Error(fetched.error.message);
    await importAll(fetched.value.file, 'replace');
    expect((await phone.engine.enableWithCode(code, { backup: fetched.value })).ok).toBe(true);
    await phone.settle();
    expect(await phone.engine.getStatus()).toMatchObject({ state: 'idle', pendingChanges: false });
    expect(h.server.putCount).toBe(4);
  });
});

describe('an upload stored on the server but answered badly', () => {
  /** A harness whose next upload is stored, then answered with `answer` instead. */
  function harnessWithBrokenAnswer(answer: () => Response) {
    let breakNext = false;
    const h = createEngineHarness({
      fetch: async (input, init) => {
        const response = await h.server.fetch(input, init);
        if (init?.method === 'PUT' && breakNext) {
          breakNext = false;
          return answer();
        }
        return response;
      },
    });
    return { h, breakNextAnswer: () => (breakNext = true) };
  }

  it.each([
    ['an unreadable 201', () => new Response('{"version":"00000', { status: 201 })],
    ['a proxy 502', () => new Response('<html>502 Bad Gateway</html>', { status: 502 })],
  ])("isn't later taken for another phone's (%s)", async (_name, answer) => {
    const { h, breakNextAnswer } = harnessWithBrokenAnswer(answer);
    await seedReal();
    await turnOn(h);
    breakNextAnswer();
    await change(h);
    await h.advance(MINUTE);
    expect(h.server.uploads).toHaveLength(2);
    expect(await loadBackupState()).toMatchObject({
      lastError: { kind: 'server-error' },
      pendingUploadSize: h.server.uploads[1]?.bytes.byteLength,
    });

    await h.advance(HOUR);
    expect(await h.engine.getStatus()).toMatchObject({ state: 'idle', pendingChanges: false });
    expect(h.server.putCount).toBe(3);
  });

  it('forgets the pending upload when the answer proves nothing was stored', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    h.server.failNext({ status: 400, error: 'body_read_failed', method: 'PUT' });
    await change(h);
    await h.advance(MINUTE);
    expect(await loadBackupState()).toMatchObject({ lastError: { kind: 'bad-request' } });
    expect(await loadBackupState()).not.toHaveProperty('pendingUploadSize');
  });
});

describe('scheduler corner cases', () => {
  it("doesn't spin when the connection drops without an offline event", async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    // navigator.onLine turned false while the app was suspended, so no event came.
    h.environment.online = false;
    await change(h);
    let runs = 0;
    await h.clock.advance(2 * MINUTE, async () => {
      runs += 1;
      if (runs > 20) h.engine.stop();
      await h.engine.whenIdle();
    });
    expect(runs).toBe(1);
    expect(h.server.putCount).toBe(1);
    expect((await h.engine.getStatus()).state).toBe('waiting-for-signal');

    h.environment.emit('online');
    await flush();
    await h.advance(0);
    expect(h.server.putCount).toBe(2);
  });

  it('during a live game, checks on online and visible also wait for a quiet spell', async () => {
    const h = createEngineHarness();
    await seedReal({ liveGame: true });
    await turnOn(h);
    await h.advance(2 * MINUTE);
    const puts = h.server.putCount;

    // A tap every 5 s (never a quiet spell), with the app coming back online and into
    // view every 70 s: nothing goes up mid-burst, then the 5-minute maximum.
    for (let i = 0; i < 59; i += 1) {
      await recordStat(REAL_LIVE_GAME_ID, 'fg2_made');
      await h.notify();
      if (i % 14 === 13) {
        h.environment.emit('offline');
        h.environment.emit('online');
        h.environment.emit('visible');
        await flush();
      }
      await h.advance(5 * SECOND);
    }
    expect(h.server.putCount).toBe(puts);
    await h.advance(5 * SECOND);
    expect(h.server.putCount).toBe(puts + 1);
  });

  it('turning on during "turn off and delete" waits for it, then makes a new code', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    const release = h.server.hold();
    const turningOff = h.engine.disable({ deleteCloudCopy: true });
    await vi.waitFor(() => expect(h.server.requests.at(-1)?.method).toBe('DELETE'));
    const turningOn = h.engine.enable();
    release();
    expect((await turningOff).ok).toBe(true);
    const newCode = await turningOn;
    expect(newCode).not.toBe(code);
    expect(await h.engine.getCode()).toBe(newCode);
    await h.settle();
    expect(await h.engine.getStatus()).toMatchObject({ enabled: true, state: 'idle' });
  });

  it("two windows on one phone don't take each other's uploads for another phone's", async () => {
    // One lock for both, as the Web Locks API gives the windows of one app.
    let chain: Promise<unknown> = Promise.resolve();
    const lock = <T>(task: () => Promise<T>): Promise<T> => {
      const run = chain.then(task);
      chain = run.catch(() => undefined);
      return run;
    };
    let holdPut: Promise<void> | undefined;
    const h = createEngineHarness({
      lock,
      fetch: async (input, init) => {
        const response = await h.server.fetch(input, init);
        if (init?.method === 'PUT' && holdPut) await holdPut;
        return response;
      },
    });
    await seedReal();
    await turnOn(h);

    let listener2: ((observation: BackupObservation) => void) | undefined;
    const window2 = new BackupEngine({
      apiUrl: () => TEST_API_URL,
      fetch: h.server.fetch,
      clock: h.clock,
      environment: h.environment,
      lock,
      observe: (next) => {
        listener2 = next;
        void readObservation().then(next);
        return () => (listener2 = undefined);
      },
    });
    window2.start();
    await flush();
    const notifyBoth = async () => {
      await h.notify();
      listener2?.(await readObservation());
    };
    const settleBoth = async () => {
      await h.engine.whenIdle();
      await window2.whenIdle();
    };
    try {
      await h.clock.advance(5 * SECOND, settleBoth);
      // Both windows see a change and their timers fire together; the first one's
      // answer is slow to arrive.
      let release!: () => void;
      holdPut = new Promise<void>((resolve) => (release = resolve));
      await change(h);
      await notifyBoth();
      await h.clock.advance(20 * SECOND);
      await vi.waitFor(() => expect(h.server.putCount).toBe(2));
      release();
      holdPut = undefined;
      await settleBoth();

      await change(h);
      await notifyBoth();
      await h.clock.advance(MINUTE, settleBoth);
      expect(await h.engine.getStatus()).toMatchObject({ state: 'idle', pendingChanges: false });
      expect(h.server.putCount).toBe(3);
    } finally {
      window2.stop();
    }
  });
});

describe('"Back up anyway" (force)', () => {
  it('overrides only the pause shown, and asks about another problem instead', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    const theirs = await uploadFromAnotherPhone(h, code);
    await clearAllData();
    await h.notify();
    await h.advance(MINUTE);
    expect((await h.engine.getStatus()).state).toBe('paused-shrink');

    // For the shrink pause: another phone's newer backup turns up, so it asks about
    // that instead of replacing it.
    expect(await h.engine.backUpNow({ force: true })).toMatchObject({
      ok: false,
      error: { kind: 'other-device' },
    });
    expect(h.server.uploads.at(-1)?.version).toBe(theirs.version);
    expect(await h.engine.getStatus()).toMatchObject({ state: 'paused-other-device' });

    // Confirmed for that too: both answers stand, and it uploads.
    expect((await h.engine.backUpNow({ force: true })).ok).toBe(true);
    expect(h.server.uploads.at(-1)?.version).not.toBe(theirs.version);
    expect(await loadBackupState()).not.toHaveProperty('confirmedPauses');
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('with nothing paused, still checks for another phone', async () => {
    const h = createEngineHarness();
    await seedReal();
    const code = await turnOn(h);
    await uploadFromAnotherPhone(h, code);
    expect(await h.engine.backUpNow({ force: true })).toMatchObject({
      ok: false,
      error: { kind: 'other-device' },
    });
    expect(h.server.putCount).toBe(2);
  });

  it('"Back up now" goes ahead when the check for another phone fails', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    h.server.failNext({ status: 503, error: 'server_busy', method: 'HEAD' });
    expect((await h.engine.backUpNow()).ok).toBe(true);
    expect(h.server.putCount).toBe(2);

    // An automatic upload waits instead.
    h.server.failNext({ status: 503, error: 'server_busy', method: 'HEAD' });
    await change(h);
    await h.advance(20 * SECOND);
    expect(h.server.putCount).toBe(2);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'error',
      lastError: { kind: 'server-busy' },
    });
  });
});

describe('messages', () => {
  it("says the server can't take a new backup, not that it's busy, for a first upload", async () => {
    const h = createEngineHarness();
    await seedReal();
    h.server.failNext({
      status: 429,
      error: 'rate_limited',
      retryAfterSeconds: 20 * 3600,
      method: 'PUT',
    });
    await h.engine.enable();
    await h.settle();
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'error',
      lastError: {
        kind: 'rate-limited',
        message:
          "The backup server can't take a new backup right now. Hoop Stats will try again in 20 hours.",
      },
    });
  });

  it('says a rejected code needs its online copy deleted to start over', async () => {
    const h = createEngineHarness();
    await seedReal();
    await turnOn(h);
    h.server.failNext({ status: 401, error: 'unauthorized', method: 'PUT' });
    await change(h);
    await h.advance(MINUTE);
    expect((await h.engine.getStatus()).lastError?.message).toBe(
      "The backup server doesn't accept this backup code anymore. To start over with a new code, turn cloud backup off and delete its online copy, then turn it back on.",
    );
  });
});
