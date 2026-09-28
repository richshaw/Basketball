import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import type { AppOptions } from '../src/app.js';
import { createApp } from '../src/app.js';
import type { ServerConfig } from '../src/config.js';
import { DEFAULT_LIMITS, DEFAULT_RETENTION } from '../src/config.js';
import type { RunningServer } from '../src/server.js';
import { startServer } from '../src/server.js';
import type { DiskSpace } from '../src/store.js';

export const ALLOWED_ORIGIN = 'https://richshaw.github.io';
export const START = Date.parse('2026-03-14T15:00:00.000Z');
export const VERSION_RE = /^\d{10}-\d{8}T\d{9}Z$/;

/** 90% free: tests must not depend on how full the machine running them is. */
export const plentyOfSpace = (): Promise<DiskSpace> =>
  Promise.resolve({ freeBytes: 900 * 2 ** 20, totalBytes: 1000 * 2 ** 20 });

export function hex64(): string {
  return randomBytes(32).toString('hex');
}

export function bytes(length: number, fill = 7): Uint8Array<ArrayBuffer> {
  return new Uint8Array(length).fill(fill);
}

/** A controllable clock (epoch ms) shared by the app and the test. */
export class TestClock {
  ms: number;
  constructor(ms = START) {
    this.ms = ms;
  }
  readonly now = (): number => this.ms;
  advance(ms: number): void {
    this.ms += ms;
  }
}

export async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'hoop-backup-test-'));
}

export interface Harness {
  app: Hono;
  dataDir: string;
  clock: TestClock;
  logs: string[];
  cleanup: () => Promise<void>;
}

/** A fresh app over a fresh temp directory (or `options.dataDir`). No sockets involved. */
export async function createHarness(options: Partial<AppOptions> = {}): Promise<Harness> {
  const dataDir = options.dataDir ?? (await makeTempDir());
  const clock = new TestClock();
  const logs: string[] = [];
  const app = createApp({
    dataDir,
    allowedOrigins: [ALLOWED_ORIGIN],
    now: clock.now,
    log: (line) => logs.push(line),
    diskSpace: plentyOfSpace,
    ...options,
  });
  return {
    app,
    dataDir,
    clock,
    logs,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  };
}

export interface TestServer {
  url: string;
  port: number;
  dataDir: string;
  logs: string[];
  close: () => Promise<void>;
}

/** The real HTTP server on a random loopback port. */
export async function startTestServer(
  overrides: Partial<ServerConfig> & { dataDir: string },
): Promise<TestServer> {
  const logs: string[] = [];
  const running: RunningServer = await startServer({
    port: 0,
    hostname: '127.0.0.1',
    allowedOrigins: [ALLOWED_ORIGIN],
    limits: { ...DEFAULT_LIMITS },
    retention: { ...DEFAULT_RETENTION },
    requestTimeoutMs: 60_000,
    now: Date.now,
    log: (line) => logs.push(line),
    diskSpace: plentyOfSpace,
    ...overrides,
  });
  return {
    url: `http://127.0.0.1:${running.port}`,
    port: running.port,
    dataDir: overrides.dataDir,
    logs,
    close: running.close,
  };
}

/** Polls `check` until it returns true or `timeoutMs` passes. */
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Opens a raw TCP connection and sends the start of an HTTP request, so tests can stall or
 * abort mid-body the way a phone losing signal would.
 */
export async function openRawRequest(port: number, head: string, body: Uint8Array) {
  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let received = '';
  socket.on('data', (chunk: Buffer) => (received += chunk.toString('latin1')));
  socket.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  socket.write(head);
  socket.write(body);
  return { socket, closed, received: () => received };
}

export function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function putBackup(
  app: Hono,
  accountId: string,
  token: string,
  body: RequestInit['body'],
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    app.request(`/v1/backups/${accountId}`, {
      method: 'PUT',
      body,
      headers: { ...auth(token), 'Content-Type': 'application/octet-stream', ...headers },
    }),
  );
}

export function getWithToken(
  app: Hono,
  urlPath: string,
  token: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(app.request(urlPath, { headers: { ...auth(token), ...headers } }));
}

/** Status of a request whose body the test doesn't need (the body is drained so any open file
 * handle behind it is released). */
export async function statusOf(response: Promise<Response> | Response): Promise<number> {
  const res = await response;
  await res.arrayBuffer();
  return res.status;
}

export interface UploadResponse {
  version: string;
  createdAt: string;
  size: number;
}

export async function uploadOk(
  app: Hono,
  accountId: string,
  token: string,
  body: Uint8Array<ArrayBuffer>,
  headers: Record<string, string> = {},
): Promise<UploadResponse> {
  const res = await putBackup(app, accountId, token, body, headers);
  if (res.status !== 201) {
    throw new Error(`expected 201, got ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as UploadResponse;
}

/** Lists a directory, or [] if it does not exist. */
export async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}
