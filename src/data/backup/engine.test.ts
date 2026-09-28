import { describe, expect, it, vi } from 'vitest';
import { createEngineHarness, TEST_START, type EngineHarness } from '@/test/backupHarness';
import { buildDemoData, DEMO_LIVE_GAME_ID, demoGameId } from '../demo';
import {
  deleteGame,
  endGame,
  getLastChangeAt,
  getSettings,
  recordStat,
  updateSettings,
} from '../repo';
import { clearAllData, exportAll, importAll } from '../transfer';
import { generateBackupCode, parseBackupCode } from './code';
import { observeDatabase, type BackupObservation } from './engine';
import { deriveBackupKeys } from './keys';
import { decryptSnapshot } from './snapshot';
import { createBackupState, loadBackupState } from './state';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const TODAY = '2026-09-27';

async function seedDemo(options: { liveGame?: boolean } = {}) {
  await importAll(buildDemoData({ today: TODAY, ...options }), 'replace');
}

/** Any data change that keeps the games (flips a setting). */
async function change(h: EngineHarness) {
  await updateSettings({ shotChart: !(await getSettings()).shotChart });
  await h.notify();
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

describe('backup scheduler', () => {
  it('does nothing while backup is off', async () => {
    const h = createEngineHarness();
    await seedDemo();
    h.engine.start();
    await h.notify();
    await change(h);
    await h.advance(30 * MINUTE);
    expect(h.server.requests).toEqual([]);
    expect(await h.engine.getStatus()).toMatchObject({ enabled: false, state: 'idle' });
  });

  it('uploads an encrypted snapshot as soon as backup is turned on', async () => {
    const h = createEngineHarness();
    await seedDemo();
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
      lastUploadedGameCount: 10,
      lastUploadedEventCount: current.events.length,
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
    await seedDemo();
    await createBackupState({ code: generateBackupCode(), enabledAt: 1 });
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
    await seedDemo();
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

  it('uploads at most once a minute during a live game, and soon after it ends', async () => {
    const h = createEngineHarness();
    await seedDemo({ liveGame: true });
    await turnOn(h);

    // A minute after the first upload (at TEST_START), not 20 s after the tap.
    await recordStat(DEMO_LIVE_GAME_ID, 'ast');
    await h.notify();
    await h.advance(MINUTE - 10 * SECOND - 1);
    expect(h.server.putCount).toBe(1);
    await h.advance(1);
    expect(h.server.putCount).toBe(2);

    // The next tap, 5 s later, waits for a minute after that upload.
    await h.advance(5 * SECOND);
    await recordStat(DEMO_LIVE_GAME_ID, 'dreb');
    await h.notify();
    await h.advance(MINUTE - 5 * SECOND - 1);
    expect(h.server.putCount).toBe(2);
    await h.advance(1);
    expect(h.server.putCount).toBe(3);

    await h.advance(30 * SECOND);
    await endGame(DEMO_LIVE_GAME_ID, { teamScore: 50, opponentScore: 40 });
    await h.notify();
    await h.advance(2 * SECOND - 1);
    expect(h.server.putCount).toBe(3);
    await h.advance(1);
    expect(h.server.putCount).toBe(4);
  });

  it('skips the upload when nothing changed', async () => {
    const h = createEngineHarness();
    await seedDemo();
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
    await seedDemo();
    await turnOn(h);

    const release = h.server.hold();
    await change(h);
    await h.clock.advance(20 * SECOND);
    await vi.waitFor(() => expect(h.server.inFlight).toBe(1));
    expect((await h.engine.getStatus()).state).toBe('backing-up');

    await change(h);
    await h.clock.advance(5 * MINUTE);
    expect(h.server.putCount).toBe(2);

    release();
    await h.settle();
    await h.advance(0);
    expect(h.server.putCount).toBe(3);
    expect(h.server.maxInFlight).toBe(1);
    expect((await loadBackupState())?.lastUploadedChangeAt).toBe(await getLastChangeAt());
  });

  it('waits for a connection, then uploads as soon as it is back', async () => {
    const h = createEngineHarness();
    await seedDemo();
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
    await seedDemo();
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

  it('waits as long as the server asks (Retry-After)', async () => {
    const h = createEngineHarness();
    await seedDemo();
    await turnOn(h);

    h.server.failNext({ status: 503, error: 'server_busy', retryAfterSeconds: 300, method: 'PUT' });
    h.server.failNext({
      status: 429,
      error: 'rate_limited',
      retryAfterSeconds: 3600,
      method: 'PUT',
    });
    await change(h);
    await h.advance(20 * SECOND);
    expect(h.server.putCount).toBe(2);
    await h.advance(5 * MINUTE - 1);
    expect(h.server.putCount).toBe(2);
    await h.advance(1);
    expect(h.server.putCount).toBe(3);
    expect((await h.engine.getStatus()).nextAttemptAt).toBe(h.clock.now() + 60 * MINUTE);
    await h.advance(60 * MINUTE);
    expect(h.server.putCount).toBe(4);
  });

  it("retries a lost connection as soon as there's signal, not after the backoff", async () => {
    const h = createEngineHarness();
    await seedDemo();
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
    expect(h.server.putCount).toBe(3);
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it.each([
    [401, 'unauthorized', 'code-rejected', "doesn't accept this backup code anymore"],
    [409, 'account_deleted', 'cloud-deleted', 'Your cloud backup was deleted'],
    [413, 'payload_too_large', 'too-large', 'too big for cloud backup'],
  ])('stops after a %i until the parent acts', async (status, error, paused, message) => {
    const h = createEngineHarness();
    await seedDemo();
    await turnOn(h);

    h.server.failNext({ status, error, method: 'PUT' });
    await change(h);
    await h.advance(20 * SECOND);
    expect(await loadBackupState()).toMatchObject({ paused });
    const status_ = await h.engine.getStatus();
    expect(status_.state).toBe('needs-attention');
    expect(status_.lastError?.message).toContain(message);

    await change(h);
    await h.advance(2 * 60 * MINUTE);
    expect(h.server.putCount).toBe(2);

    // "Back up now" tries again, and a success resumes automatic backup.
    const result = await h.engine.backUpNow();
    expect(result.ok).toBe(true);
    expect(await loadBackupState()).not.toHaveProperty('paused');
  });

  it("doesn't send a snapshot bigger than the server takes", async () => {
    const h = createEngineHarness({ maxUploadBytes: 100 });
    await seedDemo();
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

  it('keeps retrying, with a clear message, while the server is full', async () => {
    const h = createEngineHarness();
    await seedDemo();
    h.server.failNext({ status: 507, error: 'account_limit_reached', method: 'PUT' });
    await turnOn(h);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'error',
      nextAttemptAt: TEST_START + MINUTE,
      lastError: { kind: 'account-limit', message: expect.stringContaining('full') as string },
    });
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('never lets much less data replace the last backup without asking (shrink guard)', async () => {
    const h = createEngineHarness();
    await seedDemo();
    await turnOn(h);

    await clearAllData();
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(1);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'paused-shrink',
      shrink: { backedUpGames: 10, currentGames: 0 },
      lastError: {
        kind: 'shrink',
        message:
          'This phone has much less data than your last backup, so automatic backup is paused to keep that backup safe.',
      },
    });

    // Still far too little: still nothing goes up, even when asked without force.
    await change(h);
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(1);
    const refused = await h.engine.backUpNow();
    expect(!refused.ok && refused.error.kind).toBe('shrink');
    expect(h.server.putCount).toBe(1);

    // "Back up anyway": the smaller data becomes the new baseline.
    const forced = await h.engine.backUpNow({ force: true });
    expect(forced).toMatchObject({ ok: true, value: { games: 0 } });
    expect(await loadBackupState()).toMatchObject({ lastUploadedGameCount: 0 });
    expect(await loadBackupState()).not.toHaveProperty('paused');
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('resumes by itself once the data is back (e.g. after a restore)', async () => {
    const h = createEngineHarness();
    await seedDemo();
    await turnOn(h);
    await clearAllData();
    await h.notify();
    await h.advance(MINUTE);
    expect((await h.engine.getStatus()).state).toBe('paused-shrink');

    await seedDemo();
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    expect((await h.engine.getStatus()).state).toBe('idle');
  });

  it('holds back a drop of half the games or more (3 or more games)', async () => {
    const h = createEngineHarness();
    await seedDemo();
    await turnOn(h);

    await deleteGame(demoGameId(1));
    await deleteGame(demoGameId(2));
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);

    for (const n of [3, 4, 5, 6]) await deleteGame(demoGameId(n));
    await h.notify();
    await h.advance(MINUTE);
    expect(h.server.putCount).toBe(2);
    expect(await h.engine.getStatus()).toMatchObject({
      state: 'paused-shrink',
      shrink: { backedUpGames: 8, currentGames: 4 },
    });
  });

  it('sends waiting changes right away when the app is hidden', async () => {
    const h = createEngineHarness();
    await seedDemo({ liveGame: true });
    await turnOn(h);
    await h.advance(5 * SECOND);
    await recordStat(DEMO_LIVE_GAME_ID, 'stl');
    await h.notify();
    h.environment.emit('hidden');
    await h.advance(0);
    expect(h.server.putCount).toBe(2);
  });

  it('turning backup off stops everything, even an upload in flight', async () => {
    const h = createEngineHarness();
    await seedDemo();
    await turnOn(h);

    const release = h.server.hold();
    await change(h);
    await h.clock.advance(20 * SECOND);
    await vi.waitFor(() => expect(h.server.inFlight).toBe(1));
    expect(await h.engine.disable()).toEqual({ ok: true, value: undefined });
    release();
    await h.settle();
    expect(await loadBackupState()).toBeUndefined();
    expect(h.server.uploads).toHaveLength(1);

    await change(h);
    await h.advance(60 * MINUTE);
    expect(h.server.putCount).toBe(2);
    expect(await h.engine.getStatus()).toMatchObject({ enabled: false, state: 'idle' });
  });

  it('deletes the cloud copy when turned off, but only with signal', async () => {
    const h = createEngineHarness();
    await seedDemo();
    const code = await turnOn(h);
    expect(h.server.accounts.size).toBe(1);

    h.environment.emit('offline');
    expect(await h.engine.disable({ deleteCloudCopy: true })).toEqual({
      ok: false,
      error: {
        kind: 'offline',
        message:
          "No internet connection, so your cloud backup wasn't deleted. Try again when you're online.",
      },
    });
    expect(await h.engine.getCode()).toBe(code);

    h.environment.emit('online');
    expect(await h.engine.disable({ deleteCloudCopy: true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(h.server.accounts.size).toBe(0);
    expect(await h.engine.getCode()).toBeUndefined();

    // Nothing on the server under a code (401) counts as deleted too.
    await h.engine.enable();
    h.server.accounts.clear();
    expect((await h.engine.disable({ deleteCloudCopy: true })).ok).toBe(true);
  });

  it('starts once, and stops cleanly', async () => {
    const h = createEngineHarness();
    await createBackupState({ code: generateBackupCode(), enabledAt: 1 });
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

describe('observeDatabase', () => {
  it('reports data changes, the live game and the backup state, from any writer', async () => {
    const seen: BackupObservation[] = [];
    const unsubscribe = observeDatabase((observation) => seen.push(observation));
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(seen[0]).toEqual({ lastChangeAt: undefined, liveGame: false, state: undefined });

      await seedDemo({ liveGame: true });
      await vi.waitFor(() => expect(seen.at(-1)?.liveGame).toBe(true));
      const code = generateBackupCode();
      await createBackupState({ code, enabledAt: 1 });
      await vi.waitFor(() => expect(seen.at(-1)?.state).toEqual({ code, enabledAt: 1 }));
      await endGame(DEMO_LIVE_GAME_ID);
      await vi.waitFor(() => expect(seen.at(-1)?.liveGame).toBe(false));
      expect(seen.at(-1)?.lastChangeAt).toBe(await getLastChangeAt());
    } finally {
      unsubscribe();
    }
  });
});
