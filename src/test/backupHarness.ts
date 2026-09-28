/**
 * Test doubles for the cloud backup engine: a clock whose timers only fire when a test
 * moves time on, a connection and visibility the test controls, and a data
 * observation the test triggers. Real IndexedDB work keeps running on real timers.
 */
import {
  BackupEngine,
  readObservation,
  type BackupClock,
  type BackupEngineOptions,
  type BackupEnvironment,
  type BackupEnvironmentEvent,
  type BackupObservation,
} from '@/data/backup/engine';
import { FakeBackupServer } from './fakeBackupServer';

export const TEST_API_URL = 'https://backup.hoop-stats.test';
/** Sep 28, 2026, 12:00 UTC. */
export const TEST_START = Date.UTC(2026, 8, 28, 12);

export class ManualClock implements BackupClock {
  private time: number;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  private nextId = 1;

  constructor(start = TEST_START) {
    this.time = start;
  }

  now = (): number => this.time;

  setTimeout = (callback: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  /** When the earliest timer is due, or undefined if none is set. */
  nextTimerAt(): number | undefined {
    let next: number | undefined;
    for (const { at } of this.timers.values()) next = next === undefined ? at : Math.min(next, at);
    return next;
  }

  /**
   * Moves time on by `ms`, firing each timer as it falls due; after each one, awaits
   * `settle` (the work it started), so timers that work sets fire in time too.
   */
  async advance(ms: number, settle: () => Promise<void> = () => Promise.resolve()) {
    const end = this.time + ms;
    for (;;) {
      const entry = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([idA, a], [idB, b]) => a.at - b.at || idA - idB)[0];
      if (!entry) break;
      const [id, timer] = entry;
      this.timers.delete(id);
      this.time = Math.max(this.time, timer.at);
      timer.callback();
      await settle();
    }
    this.time = end;
  }
}

export class FakeEnvironment implements BackupEnvironment {
  online = true;
  private readonly listeners = new Set<(event: BackupEnvironmentEvent) => void>();

  isOnline = (): boolean => this.online;

  subscribe = (listener: (event: BackupEnvironmentEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Changes the connection (for 'online'/'offline') and tells the listeners. */
  emit(event: BackupEnvironmentEvent): void {
    if (event === 'online') this.online = true;
    if (event === 'offline') this.online = false;
    for (const listener of this.listeners) listener(event);
  }
}

export interface EngineHarness {
  engine: BackupEngine;
  clock: ManualClock;
  server: FakeBackupServer;
  environment: FakeEnvironment;
  /** Tells the engine what's in the database now (what Dexie's live query does in the app). */
  notify(): Promise<void>;
  /** Waits for running uploads, then notifies. */
  settle(): Promise<void>;
  /** Moves time on, letting each run the timers start finish. */
  advance(ms: number): Promise<void>;
  /** How many times the engine subscribed to the data. */
  subscriptions(): number;
}

/** An engine wired to test doubles (not started). */
export function createEngineHarness(options: Partial<BackupEngineOptions> = {}): EngineHarness {
  const clock = new ManualClock();
  const server = new FakeBackupServer({ now: clock.now });
  const environment = new FakeEnvironment();
  let listener: ((observation: BackupObservation) => void) | undefined;
  let subscriptions = 0;
  const notify = async () => {
    const observation = await readObservation();
    listener?.(observation);
  };
  const engine = new BackupEngine({
    apiUrl: () => TEST_API_URL,
    fetch: server.fetch,
    clock,
    environment,
    observe: (next) => {
      subscriptions += 1;
      listener = next;
      void notify();
      return () => {
        listener = undefined;
      };
    },
    ...options,
  });
  const settle = async () => {
    await engine.whenIdle();
    await notify();
    await engine.whenIdle();
  };
  return {
    engine,
    clock,
    server,
    environment,
    notify,
    settle,
    advance: (ms) => clock.advance(ms, settle),
    subscriptions: () => subscriptions,
  };
}
