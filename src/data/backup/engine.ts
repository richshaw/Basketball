/**
 * The cloud backup engine: the scheduler that quietly uploads an encrypted snapshot
 * whenever the data changes and there's signal, plus the operations behind the public
 * API (cloudBackup.ts, which holds the app's one engine).
 *
 * Scheduling, in short (timings in policy.ts):
 * - Triggers: startup, coming back online, the app becoming visible, data changes
 *   (debounced, with a maximum wait so a busy live game still uploads every minute),
 *   a game ending, and the app being hidden with changes waiting.
 * - At most one upload at a time; changes made during an upload schedule the next.
 * - Before each upload it reads `meta.lastChangeAt` (BEFORE exporting) and skips when
 *   nothing changed since the last upload.
 * - Offline: waits for the `online` event. Failures back off (1, 2, 5, 15, then every
 *   30 min), or longer if the server says so; a code the server refuses, a deleted
 *   cloud copy or data that's too big stop automatic backup until the parent acts.
 * - The shrink guard holds back a snapshot with much less data than the last upload
 *   (see isMuchSmaller) until the parent confirms with backUpNow({ force: true }), or
 *   the data grows back (e.g. after a restore).
 *
 * Nothing here runs on the tap path of the live game screen: data changes only move a
 * timer, and all work happens later, asynchronously.
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
  errorMessage,
  type CloudBackupError,
  type CloudBackupErrorKind,
  type CloudResult,
} from './errors';
import { deriveBackupKeys, isWebCryptoAvailable, type BackupKeys } from './keys';
import {
  DEFAULT_TIMINGS,
  hasUnsavedChanges,
  isConnectionProblem,
  isMuchSmaller,
  pauseReasonFor,
  retryDelayMs,
  type BackupTimings,
} from './policy';
import { decryptSnapshot, encryptSnapshot, SnapshotError } from './snapshot';
import {
  clearBackupState,
  createBackupState,
  loadBackupState,
  replaceBackupState,
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
  /** `meta.lastChangeAt`. */
  lastChangeAt: number | undefined;
  /** Whether a game is live (a game ending triggers a quick backup). */
  liveGame: boolean;
  /** The stored backup state (undefined when backup is off). */
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

type AttemptOutcome =
  | { kind: 'uploaded'; result: BackupResult }
  | {
      kind: 'skipped';
      reason: 'disabled' | 'suspended' | 'paused' | 'waiting' | 'offline' | 'nothing-new';
    }
  | { kind: 'shrink' }
  | { kind: 'failed'; error: CloudBackupError };

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

/** What the scheduler watches, read now. */
export async function readObservation(): Promise<BackupObservation> {
  const [lastChangeAt, liveGame, state] = await Promise.all([
    getLastChangeAt(),
    getLiveGame(),
    loadBackupState(),
  ]);
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
      // A failed read (storage trouble) must never break the app; the next write retries.
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
  private uploadAbort: AbortController | undefined;
  private readonly keyCache = new Map<string, Promise<BackupKeys>>();

  private runtime: BackupRuntime;
  private readonly listeners = new Set<() => void>();

  constructor(options: BackupEngineOptions) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.environment = options.environment ?? browserEnvironment;
    this.observe = options.observe ?? observeDatabase;
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
    if (this.observed) {
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

  private onEnvironment(event: BackupEnvironmentEvent): void {
    const now = this.clock.now();
    switch (event) {
      case 'online':
        this.setRuntime({ online: true });
        void this.retrySoonAfterConnectionProblem().then(() => this.requestCheck(now));
        break;
      case 'offline':
        this.setRuntime({ online: false });
        this.reschedule();
        break;
      case 'visible':
        void this.retrySoonAfterConnectionProblem().then(() => this.requestCheck(now));
        break;
      case 'hidden':
        // iOS may suspend the app any moment now: send waiting changes right away.
        if (this.firstChangeAt !== undefined) this.requestCheck(now, { urgent: true });
        break;
    }
  }

  /**
   * A failure for lack of signal shouldn't make a returning connection (or a return to
   * the app) wait out the backoff; a server that asked for time still gets it.
   */
  private async retrySoonAfterConnectionProblem(): Promise<void> {
    const state = this.state;
    if (!state?.lastError || state.nextAttemptAt === undefined) return;
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
    const state = this.state;
    if (!this.started || !this.observed || !state || this.autoRun) return undefined;
    if (this.suspended > 0 || !this.runtime.online) return undefined;
    if (state.paused && state.paused !== 'shrink') return undefined;

    let due: number | undefined;
    if (this.firstChangeAt !== undefined && this.lastChangeAt !== undefined) {
      due = Math.min(
        this.lastChangeAt + this.timings.debounceMs,
        this.firstChangeAt + this.timings.maxWaitMs,
      );
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
    if (state.nextAttemptAt !== undefined) due = Math.max(due, state.nextAttemptAt);
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
    this.firstChangeAt = this.lastChangeAt = this.checkAt = undefined;
    this.checkIsUrgent = false;
    try {
      const outcome = await this.exclusive(() => this.attempt({ manual: false, force: false }));
      // A failure with a retry scheduled: try again once the stored backoff allows.
      if (outcome.kind === 'failed' && this.state?.nextAttemptAt !== undefined) {
        this.checkAt = this.clock.now();
      }
    } catch {
      // The phone's storage failed: try again after the first backoff step.
      this.checkAt = this.clock.now() + (this.timings.retryDelaysMs[0] ?? 0);
    }
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
   * nothing changed, during a backoff or while paused; `force` skips the shrink guard.
   */
  private async attempt({
    manual,
    force,
  }: {
    manual: boolean;
    force: boolean;
  }): Promise<AttemptOutcome> {
    const state = await loadBackupState();
    this.state = state;
    if (!state) return { kind: 'skipped', reason: 'disabled' };
    if (this.suspended > 0) return { kind: 'skipped', reason: 'suspended' };
    const now = this.clock.now();
    if (!manual) {
      if (state.paused && state.paused !== 'shrink') return { kind: 'skipped', reason: 'paused' };
      if (state.nextAttemptAt !== undefined && state.nextAttemptAt > now) {
        return { kind: 'skipped', reason: 'waiting' };
      }
    }
    const api = this.api();
    if (!api || !isWebCryptoAvailable()) {
      return { kind: 'failed', error: cloudError('unavailable', 'backup') };
    }
    if (!this.environment.isOnline()) {
      return manual
        ? { kind: 'failed', error: cloudError('offline', 'backup') }
        : { kind: 'skipped', reason: 'offline' };
    }

    // Stored codes are always well formed (see readState in state.ts).
    const keys = await this.keysFor(state.code);
    // Read BEFORE exporting: a write that lands during the export then counts as a
    // newer change (and gets uploaded next time) instead of being missed.
    const changeAt = await getLastChangeAt();
    if (!manual && !hasUnsavedChanges(state, changeAt)) {
      return { kind: 'skipped', reason: 'nothing-new' };
    }
    if (!manual && state.paused === 'shrink' && state.shrink?.changeAt === changeAt) {
      return { kind: 'skipped', reason: 'paused' };
    }

    this.lastAttemptAt = now;
    const abort = new AbortController();
    this.uploadAbort = abort;
    this.setRuntime({ uploading: true });
    try {
      const file = await exportAll();
      const size = { games: file.games.length, events: file.events.length };
      const backedUp = { games: state.lastUploadedGameCount, events: state.lastUploadedEventCount };
      if (!force && isMuchSmaller(backedUp, size)) {
        const shrink = { backedUpGames: backedUp.games ?? 0, currentGames: size.games };
        await this.update(state, {
          paused: 'shrink',
          shrink: changeAt === undefined ? shrink : { ...shrink, changeAt },
          lastError: { kind: 'shrink', message: errorMessage('shrink', 'backup'), at: now },
          failures: null,
          nextAttemptAt: null,
        });
        return { kind: 'shrink' };
      }

      let snapshot: Uint8Array<ArrayBuffer>;
      try {
        snapshot = await encryptSnapshot(file, keys, { compress: this.options.compress });
      } catch {
        // WebCrypto or CompressionStream failed: nothing the server did. Retry later.
        return this.recordFailure(state, { kind: 'server-error' }, 'unexpected');
      }
      if (snapshot.byteLength > (this.options.maxUploadBytes ?? MAX_UPLOAD_BYTES)) {
        return this.recordFailure(state, { kind: 'too-large' });
      }
      const uploaded = await api.upload(keys, snapshot, { signal: abort.signal });
      if (!uploaded.ok) return this.recordFailure(state, uploaded.error);

      await this.update(state, {
        lastSuccessAt: this.clock.now(),
        lastUploadedChangeAt: changeAt ?? null,
        lastUploadedGameCount: size.games,
        lastUploadedEventCount: size.events,
        lastVersion: uploaded.value.version,
        lastError: null,
        failures: null,
        nextAttemptAt: null,
        paused: null,
        shrink: null,
      });
      return { kind: 'uploaded', result: { ...uploaded.value, ...size } };
    } finally {
      if (this.uploadAbort === abort) this.uploadAbort = undefined;
      this.setRuntime({ uploading: false });
    }
  }

  /**
   * Stores a failed upload: pauses automatic backup for failures retrying can't fix,
   * otherwise schedules a retry with backoff. `kind` overrides the error's kind.
   */
  private async recordFailure(
    state: StoredBackupState,
    error: ApiError,
    kind: CloudBackupErrorKind = error.kind,
  ): Promise<AttemptOutcome> {
    const failure = cloudError(kind, 'backup', { retryAfterMs: error.retryAfterMs });
    // Cancelled (backup was just turned off) or offline: nothing went wrong.
    if (error.kind === 'aborted' || error.kind === 'offline') {
      return { kind: 'failed', error: failure };
    }

    const now = this.clock.now();
    const lastError = { kind, message: failure.message, at: now };
    const pause = pauseReasonFor(error.kind);
    if (pause) {
      await this.update(state, {
        paused: pause,
        lastError,
        failures: null,
        nextAttemptAt: null,
        shrink: null,
      });
    } else {
      const failures = (state.failures ?? 0) + 1;
      await this.update(state, {
        lastError,
        failures,
        nextAttemptAt: now + retryDelayMs(failures, error.retryAfterMs, this.timings),
      });
    }
    return { kind: 'failed', error: failure };
  }

  // -------------------------------------------------------------------------
  // Operations behind the public API

  /**
   * Turns cloud backup on with a new code and starts the first upload (its progress
   * shows in the status). If backup is already on, resolves to the existing code.
   */
  async enable(): Promise<string> {
    if (!this.isAvailable()) throw new Error(errorMessage('unavailable', 'backup'));
    const state = await createBackupState({
      code: generateBackupCode(),
      enabledAt: this.clock.now(),
    });
    this.state = state;
    this.backUpInBackground();
    return state.code;
  }

  /**
   * Turns cloud backup on with an existing code (after restoring from it on this phone)
   * and starts an upload. The cloud copy's size becomes the shrink guard's baseline, so
   * a phone with much less data can't replace it by accident. Pass `backup`, the
   * result of fetchBackup for this code, to skip downloading it again.
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
      throw error;
    }
    const keys = await this.keysFor(code);

    let baseline = options.backup?.accountId === keys.accountId ? options.backup : undefined;
    if (!baseline) {
      const fetched = await this.fetchBackup(code);
      // 'not-found': the account exists but holds no backup, so there's nothing to protect.
      if (!fetched.ok && fetched.error.kind !== 'not-found') return fetched;
      if (fetched.ok) baseline = fetched.value;
    }

    const current = await loadBackupState();
    if (current?.code !== code) {
      const state: StoredBackupState = { code, enabledAt: this.clock.now() };
      if (baseline) {
        state.lastUploadedGameCount = baseline.games;
        state.lastUploadedEventCount = baseline.events;
        if (baseline.version !== undefined) state.lastVersion = baseline.version;
      }
      this.state = await replaceBackupState(state);
    }
    this.backUpInBackground();
    return { ok: true, value: undefined };
  }

  /**
   * Turns cloud backup off on this phone (it forgets the code). With
   * `deleteCloudCopy`, first deletes every backup stored under the code; if that
   * fails, backup stays on and the error says why.
   */
  async disable({ deleteCloudCopy = false } = {}): Promise<CloudResult<void>> {
    const state = await loadBackupState();
    if (!state) return { ok: true, value: undefined };

    this.suspended += 1;
    this.uploadAbort?.abort();
    this.reschedule();
    try {
      if (deleteCloudCopy) {
        const api = this.api();
        if (!api) return cloudFailure('unavailable', 'delete');
        const keys = await this.keysFor(state.code);
        // After any upload in flight, so none can land after the delete.
        const deleted = await this.exclusive(() => api.deleteAll(keys));
        // 401: the server holds nothing under this code (never uploaded, or deleted).
        if (!deleted.ok && deleted.error.kind !== 'unauthorized') {
          return cloudFailure(deleted.error.kind, 'delete', {
            retryAfterMs: deleted.error.retryAfterMs,
          });
        }
      }
      await clearBackupState(state);
      this.state = await loadBackupState();
      this.keyCache.delete(state.code);
      this.firstChangeAt = this.lastChangeAt = this.checkAt = undefined;
      this.lastAttemptAt = undefined;
      return { ok: true, value: undefined };
    } finally {
      this.suspended -= 1;
      this.reschedule();
    }
  }

  /**
   * Uploads now: also when nothing changed, during a backoff, or while automatic backup
   * is paused. The shrink guard still applies unless `force` is true, which is how the
   * parent confirms "Back up anyway".
   */
  async backUpNow({ force = false } = {}): Promise<CloudResult<BackupResult>> {
    if (!this.isAvailable()) return cloudFailure('unavailable', 'backup');
    try {
      const outcome = await this.exclusive(() => this.attempt({ manual: true, force }));
      switch (outcome.kind) {
        case 'uploaded':
          return { ok: true, value: outcome.result };
        case 'shrink':
          return cloudFailure('shrink', 'backup');
        case 'failed':
          return { ok: false, error: outcome.error };
        case 'skipped':
          return cloudFailure('not-enabled', 'backup');
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
        return cloudFailure(error.problem, 'restore', { message: error.message });
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
