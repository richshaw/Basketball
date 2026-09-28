/**
 * The cloud backup engine: the scheduler that quietly uploads an encrypted snapshot
 * whenever the data changes and there's signal, plus the operations behind the public
 * API (cloudBackup.ts, which holds the app's one engine).
 *
 * Scheduling, in short (timings in policy.ts):
 * - Triggers: startup, coming back online, the app becoming visible, data changes
 *   (debounced, with a maximum wait), a game ending, and the app being hidden with
 *   changes waiting. During a live game it uploads in a quiet spell between taps.
 * - At most one upload at a time; changes made during an upload schedule the next.
 * - Before each upload it reads `meta.lastChangeAt` (BEFORE exporting) and skips when
 *   nothing changed since the last upload.
 * - Offline: waits for the `online` event. Failures back off (1, 2, 5, 15, then every
 *   30 min), or longer if the server says so; a code the server refuses, a deleted
 *   cloud copy or data that's too big stop automatic backup until the parent acts.
 * - Before replacing the newest backup it checks that this phone made it: if another
 *   phone uploaded since, it pauses instead of overwriting (see checkOtherDevice).
 * - The shrink guard holds back a snapshot that has lost games from the last backup
 *   (see shrinkCheck) until the parent confirms with backUpNow({ force: true }), or
 *   the games are back (e.g. after a restore).
 *
 * Nothing here runs on the tap path of the live game screen: a write only moves a
 * timer (after a small read), and all work happens later, asynchronously.
 */
import { getLastChangeAt, getLiveGame, subscribeToChanges } from '../repo';
import { exportAll, type ExportFile } from '../transfer';
import {
  createBackupApi,
  DEFAULT_TIMEOUT_MS,
  MAX_UPLOAD_BYTES,
  type ApiError,
  type BackupApi,
  type BackupVersion,
} from './api';
import { BackupCodeError, generateBackupCode, normalizeBackupCode, parseBackupCode } from './code';
import {
  cloudError,
  cloudFailure,
  type CloudBackupError,
  type CloudBackupErrorKind,
  type CloudResult,
} from './errors';
import { deriveBackupKeys, isWebCryptoAvailable, type BackupKeys } from './keys';
import {
  DEFAULT_TIMINGS,
  hasUnsavedChanges,
  isConnectionProblem,
  pauseReasonFor,
  realData,
  retryDelayMs,
  shrinkCheck,
  type BackupTimings,
} from './policy';
import { decryptSnapshot, encryptSnapshot, SnapshotError } from './snapshot';
import {
  clearBackupState,
  isBackupOn,
  loadBackupState,
  replaceBackupState,
  turnOffBackupState,
  turnOnBackupState,
  updateBackupState,
  type BackupGeneration,
  type BackupStatePatch,
  type StoredBackupState,
} from './state';
import { deriveStatus, type BackupRuntime, type CloudBackupStatus } from './status';

/** Timers and time, injectable so tests can drive the scheduler step by step. */
export interface BackupClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type BackupEnvironmentEvent = 'online' | 'offline' | 'visible' | 'hidden';

/** The browser's connection and visibility. */
export interface BackupEnvironment {
  isOnline(): boolean;
  /** Calls `listener` on each change; returns an unsubscribe function. */
  subscribe(listener: (event: BackupEnvironmentEvent) => void): () => void;
}

/** What the scheduler watches in the database. */
export interface BackupObservation {
  /** `meta.lastChangeAt` (not read while backup is off). */
  lastChangeAt: number | undefined;
  /** Whether a game is live (not read while backup is off). */
  liveGame: boolean;
  /** The stored backup state: undefined without a code, `disabledAt` set when off. */
  state: StoredBackupState | undefined;
}

export interface BackupEngineOptions {
  /** The backup server's base URL, looked up on each use (undefined: unavailable). */
  apiUrl: () => string | undefined;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  clock?: BackupClock;
  environment?: BackupEnvironment;
  /** Calls back with the current observation, then on every change; returns unsubscribe. */
  observe?: (listener: (observation: BackupObservation) => void) => () => void;
  /** Reads the observation now (to recover from a failed read). Defaults to readObservation. */
  read?: () => Promise<BackupObservation>;
  timings?: Partial<BackupTimings>;
  /** Gzip snapshots (default: when the browser can). */
  compress?: boolean;
  requestTimeoutMs?: number;
  /** Largest snapshot to upload (default: the server's 5 MiB limit). */
  maxUploadBytes?: number;
}

/** A successful upload. */
export interface BackupResult {
  version: string;
  /** When the upload started (epoch ms, server clock). */
  createdAt: number;
  /** Encrypted bytes uploaded. */
  size: number;
  games: number;
  events: number;
}

/** A backup downloaded and decrypted for a restore (import it with importAll). */
export interface CloudBackup {
  /** The data, already validated by parseExportFile. */
  file: ExportFile;
  /** The server's id for this version. */
  version?: string;
  /** When it was uploaded (epoch ms, server clock). */
  createdAt?: number;
  /**
   * When the phone made this snapshot (epoch ms). It's inside the encrypted data, so
   * unlike `createdAt` the server can't change it: show this one to the parent.
   */
  exportedAt: number;
  /** Encrypted size in bytes. */
  size: number;
  games: number;
  events: number;
  /** The account it came from, so enableCloudBackupWithCode can reuse it. */
  accountId: string;
}

type SkipReason = 'disabled' | 'suspended' | 'paused' | 'waiting' | 'offline' | 'nothing-new';

type AttemptOutcome =
  | { kind: 'uploaded'; result: BackupResult }
  | { kind: 'skipped'; reason: SkipReason }
  /** Paused for the parent: the shrink guard, or another phone's newer backup. */
  | { kind: 'held'; error: CloudBackupError }
  | { kind: 'failed'; error: CloudBackupError };

const skipped = (reason: SkipReason): AttemptOutcome => ({ kind: 'skipped', reason });

const systemClock: BackupClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** `navigator.onLine` plus the online/offline and visibilitychange events. */
export const browserEnvironment: BackupEnvironment = {
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  subscribe(listener) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return () => undefined;
    const online = () => listener('online');
    const offline = () => listener('offline');
    const visibility = () => listener(document.visibilityState === 'hidden' ? 'hidden' : 'visible');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visibility);
    };
  },
};

/**
 * What the scheduler watches, read now. While backup is off that's one small read:
 * the data and the live game aren't read at all.
 */
export async function readObservation(): Promise<BackupObservation> {
  const state = await loadBackupState();
  if (!isBackupOn(state)) return { lastChangeAt: undefined, liveGame: false, state };
  const [lastChangeAt, liveGame] = await Promise.all([getLastChangeAt(), getLiveGame()]);
  return { lastChangeAt, liveGame: liveGame !== undefined, state };
}

/**
 * Calls `listener` with the current observation, then again after writes (from any
 * tab, via subscribeToChanges). A burst of writes is read once, after the last read.
 */
export function observeDatabase(listener: (observation: BackupObservation) => void): () => void {
  let stopped = false;
  let reading = false;
  let readAgain = false;
  const read = async () => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      do {
        readAgain = false;
        const observation = await readObservation();
        if (!stopped) listener(observation);
      } while (readAgain && !stopped);
    } catch {
      // A failed read (storage trouble) must never break the app. The next write, or
      // the engine on the next startup, online or visible event, reads again.
    } finally {
      reading = false;
    }
  };
  const unsubscribe = subscribeToChanges(() => void read());
  void read();
  return () => {
    stopped = true;
    unsubscribe();
  };
}

const MAX_CACHED_KEYS = 4;

export class BackupEngine {
  private readonly options: BackupEngineOptions;
  private readonly clock: BackupClock;
  private readonly environment: BackupEnvironment;
  private readonly observe: (listener: (observation: BackupObservation) => void) => () => void;
  private readonly read: () => Promise<BackupObservation>;
  private timings: BackupTimings;

  private started = false;
  private unsubscribe: (() => void)[] = [];
  private timer: unknown;
  private timerDueAt: number | undefined;

  // What the scheduler knows (from the database observation and its own writes).
  private observed = false;
  private observedChangeAt: number | undefined;
  private liveGame = false;
  private state: StoredBackupState | undefined;

  // What it has been asked to do.
  /** First and latest data change seen since the last automatic run started. */
  private firstChangeAt: number | undefined;
  private lastChangeAt: number | undefined;
  /** An explicit check (startup, online, visible, game end, hidden), and when. */
  private checkAt: number | undefined;
  /** The check may skip the minimum interval (the app is being hidden). */
  private checkIsUrgent = false;
  private lastAttemptAt: number | undefined;

  // Work in progress.
  private queue: Promise<unknown> = Promise.resolve();
  private autoRun: Promise<void> | undefined;
  private suspended = 0;
  private disabling: Promise<CloudResult<void>> | undefined;
  private uploadAbort: AbortController | undefined;
  private readonly keyCache = new Map<string, Promise<BackupKeys>>();

  private runtime: BackupRuntime;
  private readonly listeners = new Set<() => void>();

  constructor(options: BackupEngineOptions) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.environment = options.environment ?? browserEnvironment;
    this.observe = options.observe ?? observeDatabase;
    this.read = options.read ?? readObservation;
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.runtime = { uploading: false, online: this.environment.isOnline() };
  }

  // -------------------------------------------------------------------------
  // Availability, runtime status and settings

  /** A backup server is configured and the browser can do the cryptography. */
  isAvailable(): boolean {
    return this.options.apiUrl() !== undefined && isWebCryptoAvailable();
  }

  /** For useSyncExternalStore: what this window is doing right now. */
  getRuntime = (): BackupRuntime => this.runtime;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setRuntime(change: Partial<BackupRuntime>): void {
    const next = { ...this.runtime, ...change };
    if (next.uploading === this.runtime.uploading && next.online === this.runtime.online) return;
    this.runtime = next;
    for (const listener of this.listeners) listener();
  }

  /** Changes the scheduler's timings (e2e tests shorten them). */
  setTimings(timings: Partial<BackupTimings>): void {
    this.timings = { ...this.timings, ...timings };
    this.reschedule();
  }

  async getStatus(): Promise<CloudBackupStatus> {
    const [stored, lastChangeAt] = await Promise.all([loadBackupState(), getLastChangeAt()]);
    return deriveStatus({
      available: this.isAvailable(),
      stored,
      lastChangeAt,
      runtime: this.runtime,
    });
  }

  /** The code, also while backup is off with the code kept; undefined without one. */
  async getCode(): Promise<string | undefined> {
    return (await loadBackupState())?.code;
  }

  // -------------------------------------------------------------------------
  // The scheduler

  /**
   * Starts automatic backup: watches the data, the connection and visibility.
   * Idempotent; does nothing in a build without a backup server.
   */
  start(): void {
    if (this.started || !this.isAvailable()) return;
    this.started = true;
    this.setRuntime({ online: this.environment.isOnline() });
    this.unsubscribe = [
      this.environment.subscribe((event) => this.onEnvironment(event)),
      this.observe((observation) => this.onObservation(observation)),
    ];
    this.requestCheck(this.clock.now() + this.timings.startupDelayMs);
  }

  /** Stops automatic backup (an upload already running finishes). */
  stop(): void {
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.unsubscribe = [];
    this.started = false;
    this.observed = false;
    this.firstChangeAt = this.lastChangeAt = this.checkAt = undefined;
    this.reschedule();
  }

  /** Resolves once no upload is running or queued (for tests). */
  async whenIdle(): Promise<void> {
    for (;;) {
      const queue = this.queue;
      const autoRun = this.autoRun;
      await queue;
      await autoRun;
      if (queue === this.queue && autoRun === this.autoRun) return;
    }
  }

  private onObservation(observation: BackupObservation): void {
    const now = this.clock.now();
    // Changes only count while backup is on (off, the data isn't even read).
    if (this.observed && isBackupOn(this.state) && isBackupOn(observation.state)) {
      if (observation.lastChangeAt !== this.observedChangeAt) {
        this.firstChangeAt ??= now;
        this.lastChangeAt = now;
      }
      // Back a game up right after it ends, not a debounce later.
      if (this.liveGame && !observation.liveGame) {
        this.requestCheck(now + this.timings.gameEndDelayMs);
      }
    }
    this.observed = true;
    this.observedChangeAt = observation.lastChangeAt;
    this.liveGame = observation.liveGame;
    this.state = observation.state;
    this.reschedule();
  }

  /** Reads the database again if the last read failed (so nothing is known yet). */
  private refreshObservation(): void {
    if (this.observed || !this.started) return;
    void this.read().then(
      (observation) => {
        if (this.started) this.onObservation(observation);
      },
      () => undefined,
    );
  }

  private onEnvironment(event: BackupEnvironmentEvent): void {
    const now = this.clock.now();
    switch (event) {
      case 'online':
        this.setRuntime({ online: true });
        this.refreshObservation();
        void this.retrySoonAfterConnectionProblem().then(() => this.requestCheck(now));
        break;
      case 'offline':
        this.setRuntime({ online: false });
        this.reschedule();
        break;
      case 'visible':
        this.refreshObservation();
        void this.retrySoonAfterConnectionProblem().then(() => this.requestCheck(now));
        break;
      case 'hidden':
        // iOS may suspend the app any moment now: send waiting changes right away,
        // even in a backoff after a lost connection.
        if (this.hasWaitingChanges()) {
          void this.retrySoonAfterConnectionProblem().then(() =>
            this.requestCheck(now, { urgent: true }),
          );
        }
        break;
    }
  }

  /** Whether backup is on with changes the cloud doesn't have yet (as last observed). */
  private hasWaitingChanges(): boolean {
    const state = this.state;
    if (!isBackupOn(state)) return false;
    return this.firstChangeAt !== undefined || hasUnsavedChanges(state, this.observedChangeAt);
  }

  /**
   * A failure for lack of signal shouldn't make a returning connection (or a return to
   * the app, or leaving it) wait out the backoff; a server that asked for time still
   * gets it.
   */
  private async retrySoonAfterConnectionProblem(): Promise<void> {
    const state = this.state;
    if (!isBackupOn(state) || !state.lastError || state.nextAttemptAt === undefined) return;
    if (!isConnectionProblem(state.lastError.kind)) return;
    try {
      await this.update(state, { nextAttemptAt: null });
    } catch {
      // Storage trouble: the backoff simply runs its course.
    }
  }

  private requestCheck(at: number, { urgent = false } = {}): void {
    this.checkAt = this.checkAt === undefined ? at : Math.min(this.checkAt, at);
    if (urgent) this.checkIsUrgent = true;
    this.reschedule();
  }

  /** When the next automatic run should start, or undefined for none. */
  private nextRunAt(): number | undefined {
    if (!this.started || this.autoRun || this.suspended > 0 || !this.runtime.online) {
      return undefined;
    }
    const state = this.state;
    // Before the first observation the state is unknown: a check (e.g. at startup)
    // still runs, and reads the state itself.
    if (this.observed && !isBackupOn(state)) return undefined;
    if (state?.paused && state.paused !== 'shrink') return undefined;

    let due: number | undefined;
    if (this.firstChangeAt !== undefined && this.lastChangeAt !== undefined) {
      const maxWait = this.liveGame ? this.timings.liveGameMaxWaitMs : this.timings.maxWaitMs;
      due = Math.min(this.lastChangeAt + this.timings.debounceMs, this.firstChangeAt + maxWait);
    }
    if (this.checkAt !== undefined)
      due = due === undefined ? this.checkAt : Math.min(due, this.checkAt);
    if (due === undefined) return undefined;

    const urgent = this.checkIsUrgent && due === this.checkAt;
    if (this.lastAttemptAt !== undefined && !urgent) {
      const interval = this.liveGame
        ? this.timings.liveGameMinIntervalMs
        : this.timings.minIntervalMs;
      due = Math.max(due, this.lastAttemptAt + interval);
    }
    if (state?.nextAttemptAt !== undefined) due = Math.max(due, state.nextAttemptAt);
    return due;
  }

  private reschedule(): void {
    const due = this.nextRunAt();
    if (due === this.timerDueAt) return;
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer);
    this.timer = undefined;
    this.timerDueAt = due;
    if (due !== undefined) {
      this.timer = this.clock.setTimeout(() => this.onTimer(), Math.max(0, due - this.clock.now()));
    }
  }

  private onTimer(): void {
    this.timer = undefined;
    this.timerDueAt = undefined;
    this.autoRun = this.runAutomatically().finally(() => {
      this.autoRun = undefined;
      this.reschedule();
    });
  }

  private async runAutomatically(): Promise<void> {
    // This run covers every change and check asked for so far.
    const waiting = { first: this.firstChangeAt, last: this.lastChangeAt };
    this.firstChangeAt = this.lastChangeAt = this.checkAt = undefined;
    this.checkIsUrgent = false;
    this.refreshObservation();
    try {
      const outcome = await this.exclusive(() => this.attempt({ manual: false, force: false }));
      // A failure with a retry scheduled: try again once the stored backoff allows.
      if (outcome.kind === 'failed' && this.state?.nextAttemptAt !== undefined) {
        this.checkAt = this.clock.now();
      }
      // Not tried after all (turning off, offline, cancelled): the changes still wait.
      const notTried =
        (outcome.kind === 'skipped' &&
          (outcome.reason === 'suspended' || outcome.reason === 'offline')) ||
        (outcome.kind === 'failed' && outcome.error.kind === 'aborted');
      if (notTried) this.restoreWaiting(waiting);
    } catch {
      // The phone's storage failed: try again after the first backoff step.
      this.checkAt = this.clock.now() + (this.timings.retryDelaysMs[0] ?? 0);
      this.restoreWaiting(waiting);
    }
  }

  private restoreWaiting({ first, last }: { first?: number; last?: number }): void {
    if (first !== undefined) {
      this.firstChangeAt = Math.min(first, this.firstChangeAt ?? first);
    }
    if (last !== undefined) this.lastChangeAt = Math.max(last, this.lastChangeAt ?? last);
  }

  /** Runs `task` after every upload or delete queued before it. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // -------------------------------------------------------------------------
  // Uploading

  private api(): BackupApi | undefined {
    const baseUrl = this.options.apiUrl();
    if (baseUrl === undefined) return undefined;
    return createBackupApi({
      baseUrl,
      fetch: this.options.fetch,
      timeoutMs: this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      isOnline: () => this.environment.isOnline(),
      now: () => this.clock.now(),
    });
  }

  /**
   * The keys for a code in its standard form, derived once. Rejects with
   * BackupCodeError for a code that isn't well formed.
   */
  private keysFor(code: string): Promise<BackupKeys> {
    let keys = this.keyCache.get(code);
    if (!keys) {
      if (this.keyCache.size >= MAX_CACHED_KEYS) this.keyCache.clear();
      keys = Promise.resolve(code).then((text) => deriveBackupKeys(parseBackupCode(text)));
      keys.catch(() => this.keyCache.delete(code));
      this.keyCache.set(code, keys);
    }
    return keys;
  }

  private async update(
    generation: BackupGeneration,
    patch: BackupStatePatch,
  ): Promise<StoredBackupState | undefined> {
    const updated = await updateBackupState(generation, patch);
    if (updated) this.state = updated;
    return updated;
  }

  /**
   * One upload attempt, run through `exclusive`. `manual` (backUpNow) also runs when
   * nothing changed, during a backoff or while paused; `force` skips the shrink guard
   * and the other-phone check.
   */
  private async attempt(options: { manual: boolean; force: boolean }): Promise<AttemptOutcome> {
    // Before the first await, so turning off can stop this attempt at any step.
    const abort = new AbortController();
    this.uploadAbort = abort;
    try {
      return await this.tryUpload(options, abort.signal);
    } finally {
      if (this.uploadAbort === abort) this.uploadAbort = undefined;
      this.setRuntime({ uploading: false });
    }
  }

  private async tryUpload(
    { manual, force }: { manual: boolean; force: boolean },
    signal: AbortSignal,
  ): Promise<AttemptOutcome> {
    const stopped = () => signal.aborted || this.suspended > 0;
    const state = await loadBackupState();
    this.state = state;
    if (!isBackupOn(state)) return skipped('disabled');
    if (stopped()) return skipped('suspended');
    const now = this.clock.now();
    if (!manual) {
      if (state.paused && state.paused !== 'shrink') return skipped('paused');
      if (state.nextAttemptAt !== undefined && state.nextAttemptAt > now) return skipped('waiting');
    }
    const api = this.api();
    if (!api || !isWebCryptoAvailable()) {
      return { kind: 'failed', error: cloudError('unavailable', 'backup') };
    }
    if (!this.environment.isOnline()) {
      return manual
        ? { kind: 'failed', error: cloudError('offline', 'backup') }
        : skipped('offline');
    }

    // Stored codes are always well formed (see readState in state.ts).
    const keys = await this.keysFor(state.code);
    // Read BEFORE exporting: a write that lands during the export then counts as a
    // newer change (and gets uploaded next time) instead of being missed.
    const changeAt = await getLastChangeAt();
    if (!manual && !hasUnsavedChanges(state, changeAt)) return skipped('nothing-new');
    if (!manual && state.paused === 'shrink' && state.shrink?.changeAt === changeAt) {
      return skipped('paused');
    }
    if (stopped()) return skipped('suspended');

    this.lastAttemptAt = now;
    this.setRuntime({ uploading: true });
    const file = await exportAll();
    const data = realData(file);
    // The shrink guard first: it needs no network, so a paused phone sends nothing.
    const finding = force ? undefined : shrinkCheck(state, data);
    if (finding) {
      const shrink = changeAt === undefined ? finding : { ...finding, changeAt };
      const error = cloudError('shrink', 'backup');
      await this.update(state, {
        paused: 'shrink',
        shrink,
        lastError: { kind: error.kind, message: error.message, at: now },
        failures: null,
        nextAttemptAt: null,
      });
      return { kind: 'held', error };
    }
    if (!force) {
      const verdict = await this.checkOtherDevice(api, keys, state, { manual, signal });
      if (verdict) return verdict;
    }
    if (stopped()) return skipped('suspended');

    let snapshot: Uint8Array<ArrayBuffer>;
    try {
      snapshot = await encryptSnapshot(file, keys, { compress: this.options.compress });
    } catch {
      // WebCrypto or CompressionStream failed: nothing the server did. Retry later.
      return this.recordFailure(state, { kind: 'server-error' }, { kind: 'unexpected' });
    }
    if (snapshot.byteLength > (this.options.maxUploadBytes ?? MAX_UPLOAD_BYTES)) {
      return this.recordFailure(state, { kind: 'too-large' });
    }
    // If the answer never comes, the server's newest version may still be this upload:
    // its size tells the next check it was ours, not another phone's.
    if (stopped() || !(await this.update(state, { pendingUploadSize: snapshot.byteLength }))) {
      return skipped('suspended');
    }
    const uploaded = await api.upload(keys, snapshot, { signal });
    if (!uploaded.ok) {
      return this.recordFailure(state, uploaded.error, {
        answered: uploaded.error.status !== undefined,
      });
    }

    await this.update(state, {
      lastSuccessAt: this.clock.now(),
      lastUploadedChangeAt: changeAt ?? null,
      backedUpGameIds: data.gameIds,
      backedUpEventCount: data.events,
      lastVersion: uploaded.value.version,
      pendingUploadSize: null,
      lastError: null,
      failures: null,
      nextAttemptAt: null,
      paused: null,
      shrink: null,
      otherDevice: null,
    });
    return {
      kind: 'uploaded',
      result: { ...uploaded.value, games: file.games.length, events: file.events.length },
    };
  }

  /**
   * Before replacing the newest backup, makes sure this phone made it. Resolves to
   * undefined to go ahead, or to why not:
   * - another phone uploaded since this one did: pause ('other-device');
   * - no account although this phone had backed up (the cloud copy was deleted, e.g.
   *   from the other phone): pause ('cloud-deleted'), never quietly make it again
   *   (the parent's own "Back up now" does, on purpose);
   * - the check itself failed (no signal, a busy server): a failure, retried later.
   * No account before this phone's first upload, or no versions yet, is fine.
   */
  private async checkOtherDevice(
    api: BackupApi,
    keys: BackupKeys,
    state: StoredBackupState,
    { manual, signal }: { manual: boolean; signal: AbortSignal },
  ): Promise<AttemptOutcome | undefined> {
    const latest = await api.latest(keys, { signal });
    if (!latest.ok) {
      const { kind } = latest.error;
      if (kind === 'not-found') return undefined;
      if (kind === 'unauthorized') {
        return state.lastVersion === undefined || manual
          ? undefined
          : this.recordFailure(state, { kind: 'account-deleted', status: 401 });
      }
      return this.recordFailure(state, latest.error);
    }

    const { version, createdAt, size } = latest.value;
    if (version === undefined || version === state.lastVersion) return undefined;
    if (state.pendingUploadSize !== undefined && size === state.pendingUploadSize) {
      // This phone's own upload, whose answer never arrived.
      await this.update(state, { lastVersion: version, pendingUploadSize: null });
      return undefined;
    }
    const error = cloudError('other-device', 'backup');
    await this.update(state, {
      paused: 'other-device',
      otherDevice: createdAt === undefined ? { version } : { version, createdAt },
      lastError: { kind: error.kind, message: error.message, at: this.clock.now() },
      failures: null,
      nextAttemptAt: null,
    });
    return { kind: 'held', error };
  }

  /**
   * Stores a failed attempt: pauses automatic backup for failures retrying can't fix,
   * otherwise schedules a retry with backoff. `kind` overrides the error's kind for
   * the parent; `answered` says the server answered an upload (so it stored nothing).
   */
  private async recordFailure(
    state: StoredBackupState,
    error: ApiError,
    {
      kind = error.kind,
      answered = false,
    }: { kind?: CloudBackupErrorKind; answered?: boolean } = {},
  ): Promise<AttemptOutcome> {
    // Cancelled (backup was just turned off) or offline: nothing went wrong.
    if (error.kind === 'aborted' || error.kind === 'offline') {
      return { kind: 'failed', error: cloudError(kind, 'backup') };
    }
    const now = this.clock.now();
    const pendingUploadSize = answered ? null : undefined;
    const pause = pauseReasonFor(error.kind);
    if (pause) {
      const failure = cloudError(kind, 'backup');
      await this.update(state, {
        paused: pause,
        lastError: { kind, message: failure.message, at: now },
        failures: null,
        nextAttemptAt: null,
        shrink: null,
        otherDevice: null,
        pendingUploadSize,
      });
      return { kind: 'failed', error: failure };
    }
    const failures = (state.failures ?? 0) + 1;
    const delay = retryDelayMs(failures, error.retryAfterMs, this.timings);
    const failure = cloudError(kind, 'backup', { retryAfterMs: error.retryAfterMs, waitMs: delay });
    await this.update(state, {
      lastError: { kind, message: failure.message, at: now },
      failures,
      nextAttemptAt: now + delay,
      pendingUploadSize,
    });
    return { kind: 'failed', error: failure };
  }

  // -------------------------------------------------------------------------
  // Operations behind the public API

  /**
   * Turns cloud backup on and starts an upload (its progress shows in the status).
   * Reuses the code this phone kept when backup was turned off (so no new account on
   * the server); otherwise makes a new one. Resolves to the code; if backup is
   * already on, to the current one.
   */
  async enable(): Promise<string> {
    if (!this.isAvailable()) throw new Error(cloudError('unavailable', 'backup').message);
    const state = await turnOnBackupState(generateBackupCode(), this.clock.now());
    this.state = state;
    this.backUpInBackground();
    return state.code;
  }

  /**
   * Turns cloud backup on with an existing code (after restoring from it on this phone)
   * and starts an upload. The backup's games become the shrink guard's baseline, so a
   * phone without them can't replace it by accident. Pass `backup`, the result of
   * fetchBackup for this code, to skip downloading it again.
   */
  async enableWithCode(
    input: string,
    options: { backup?: CloudBackup } = {},
  ): Promise<CloudResult<void>> {
    if (!this.isAvailable()) return cloudFailure('unavailable', 'restore');
    let code: string;
    try {
      code = normalizeBackupCode(input);
    } catch (error) {
      if (error instanceof BackupCodeError) {
        return cloudFailure('invalid-code', 'restore', { message: error.message });
      }
      return cloudFailure('unexpected', 'restore');
    }
    try {
      const keys = await this.keysFor(code);
      let baseline = options.backup?.accountId === keys.accountId ? options.backup : undefined;
      if (!baseline) {
        const fetched = await this.fetchBackup(code);
        // 'not-found': the account exists but holds no backup, so there's nothing to protect.
        if (!fetched.ok && fetched.error.kind !== 'not-found') return fetched;
        if (fetched.ok) baseline = fetched.value;
      }

      const current = await loadBackupState();
      if (!isBackupOn(current) || current.code !== code) {
        const state: StoredBackupState = { code, enabledAt: this.clock.now() };
        if (baseline) {
          const data = realData(baseline.file);
          state.backedUpGameIds = data.gameIds;
          state.backedUpEventCount = data.events;
          if (baseline.version !== undefined) state.lastVersion = baseline.version;
        }
        this.state = await replaceBackupState(state);
      }
      this.backUpInBackground();
      return { ok: true, value: undefined };
    } catch {
      return cloudFailure('unexpected', 'restore');
    }
  }

  /**
   * Turns cloud backup off. The phone keeps the code (and its account on the server),
   * so turning backup on again reuses it. With `deleteCloudCopy`, every backup stored
   * under the code is deleted first and the phone forgets the code; if the delete
   * fails, backup stays as it was and the error says why.
   */
  disable({ deleteCloudCopy = false } = {}): Promise<CloudResult<void>> {
    const run = this.turnOff(deleteCloudCopy).finally(() => {
      if (this.disabling === run) this.disabling = undefined;
    });
    this.disabling = run;
    return run;
  }

  private async turnOff(deleteCloudCopy: boolean): Promise<CloudResult<void>> {
    let suspended = false;
    try {
      const state = await loadBackupState();
      if (!state || (!deleteCloudCopy && !isBackupOn(state))) return { ok: true, value: undefined };

      this.suspended += 1;
      suspended = true;
      this.uploadAbort?.abort();
      this.reschedule();
      if (deleteCloudCopy) {
        const api = this.api();
        if (!api) return cloudFailure('unavailable', 'delete');
        const keys = await this.keysFor(state.code);
        // After any upload in flight, so none can land after the delete.
        const deleted = await this.exclusive(() => api.deleteAll(keys));
        // 401: the server holds nothing under this code (never uploaded, or deleted).
        if (!deleted.ok && deleted.error.kind !== 'unauthorized') {
          // Backup stays on: look again for changes that were waiting.
          this.requestCheck(this.clock.now());
          return cloudFailure(deleted.error.kind, 'delete', {
            retryAfterMs: deleted.error.retryAfterMs,
          });
        }
        await clearBackupState(state);
        this.keyCache.delete(state.code);
      } else {
        await turnOffBackupState(state, this.clock.now());
      }
      this.state = await loadBackupState();
      this.firstChangeAt = this.lastChangeAt = this.checkAt = undefined;
      this.lastAttemptAt = undefined;
      return { ok: true, value: undefined };
    } catch {
      return cloudFailure('unexpected', 'delete');
    } finally {
      if (suspended) this.suspended -= 1;
      this.reschedule();
    }
  }

  /**
   * Uploads now: also when nothing changed, during a backoff, or while automatic backup
   * is paused. The shrink guard and the other-phone check still apply unless `force`
   * is true, which is how the parent confirms "Back up anyway".
   */
  async backUpNow({ force = false } = {}): Promise<CloudResult<BackupResult>> {
    if (!this.isAvailable()) return cloudFailure('unavailable', 'backup');
    try {
      // Being turned off: wait, then see whether backup is still on.
      if (this.disabling) await this.disabling;
      const outcome = await this.exclusive(() => this.attempt({ manual: true, force }));
      switch (outcome.kind) {
        case 'uploaded':
          return { ok: true, value: outcome.result };
        case 'held':
        case 'failed':
          return { ok: false, error: outcome.error };
        case 'skipped':
          return cloudFailure(outcome.reason === 'disabled' ? 'not-enabled' : 'aborted', 'backup');
      }
    } catch {
      return cloudFailure('unexpected', 'backup');
    } finally {
      this.reschedule();
    }
  }

  private backUpInBackground(): void {
    // backUpNow never rejects; its outcome shows in the status.
    void this.backUpNow();
  }

  /**
   * Downloads and decrypts the newest backup for a code (or `version`), for a restore
   * preview. The data isn't imported: the caller does that with importAll.
   */
  async fetchBackup(
    input: string,
    options: { version?: string } = {},
  ): Promise<CloudResult<CloudBackup>> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) return prepared;
    const { api, keys } = prepared.value;
    const downloaded = await api.download(keys, options.version);
    if (!downloaded.ok) {
      const { kind, retryAfterMs } = downloaded.error;
      const message =
        kind === 'not-found' && options.version !== undefined
          ? 'That backup is no longer on the server.'
          : undefined;
      return cloudFailure(kind, 'restore', { message, retryAfterMs });
    }
    try {
      const file = await decryptSnapshot(downloaded.value.bytes, keys);
      const backup: CloudBackup = {
        file,
        exportedAt: Date.parse(file.exportedAt),
        size: downloaded.value.bytes.byteLength,
        games: file.games.length,
        events: file.events.length,
        accountId: keys.accountId,
      };
      if (downloaded.value.version !== undefined) backup.version = downloaded.value.version;
      if (downloaded.value.createdAt !== undefined) backup.createdAt = downloaded.value.createdAt;
      return { ok: true, value: backup };
    } catch (error) {
      if (error instanceof SnapshotError) {
        // The server accepted this code's token, so the code is right: bytes that
        // won't decrypt were damaged.
        const problem = error.problem === 'wrong-code' ? 'damaged' : error.problem;
        return cloudFailure(problem, 'restore');
      }
      return cloudFailure('unexpected', 'restore');
    }
  }

  /** Every stored backup for a code, newest first (for "restore an earlier backup"). */
  async listVersions(input: string): Promise<CloudResult<BackupVersion[]>> {
    const prepared = await this.prepare(input);
    if (!prepared.ok) return prepared;
    const listed = await prepared.value.api.list(prepared.value.keys);
    return listed.ok
      ? listed
      : cloudFailure(listed.error.kind, 'restore', { retryAfterMs: listed.error.retryAfterMs });
  }

  /** The API and keys for a code the parent typed, or why there can't be any. */
  private async prepare(input: string): Promise<CloudResult<{ api: BackupApi; keys: BackupKeys }>> {
    const api = this.api();
    if (!api || !isWebCryptoAvailable()) return cloudFailure('unavailable', 'restore');
    try {
      return { ok: true, value: { api, keys: await this.keysFor(normalizeBackupCode(input)) } };
    } catch (error) {
      if (error instanceof BackupCodeError) {
        return cloudFailure('invalid-code', 'restore', { message: error.message });
      }
      return cloudFailure('unexpected', 'restore');
    }
  }
}
