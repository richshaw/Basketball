import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Hono } from 'hono';
import type { AppOptions } from '../src/app.js';
import { createApp } from '../src/app.js';

export const ALLOWED_ORIGIN = 'https://richshaw.github.io';
export const START = Date.parse('2026-03-14T15:00:00.000Z');

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

export interface Harness {
  app: Hono;
  dataDir: string;
  clock: TestClock;
  logs: string[];
  cleanup: () => Promise<void>;
}

/** A fresh app over a fresh temp directory. Nothing touches the network. */
export async function createHarness(options: Partial<AppOptions> = {}): Promise<Harness> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'hoop-backup-test-'));
  const clock = new TestClock();
  const logs: string[] = [];
  const app = createApp({
    dataDir,
    allowedOrigins: [ALLOWED_ORIGIN],
    now: clock.now,
    log: (line) => logs.push(line),
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
