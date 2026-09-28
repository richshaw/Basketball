import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { open, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/config.js';
import { isErrno, readDiskSpace } from '../src/store.js';
import type { TestServer } from './helpers.js';
import {
  auth,
  bytes,
  hex64,
  listDir,
  makeTempDir,
  openRawRequest,
  startTestServer,
  waitFor,
} from './helpers.js';

// These tests run the real HTTP server on a random 127.0.0.1 port.

let dataDir: string;
let server: TestServer | undefined;

beforeEach(async () => {
  dataDir = await makeTempDir();
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(dataDir, { recursive: true, force: true });
});

function put(s: TestServer, accountId: string, token: string, body: Uint8Array) {
  return fetch(`${s.url}/v1/backups/${accountId}`, {
    method: 'PUT',
    headers: { ...auth(token), 'Content-Type': 'application/octet-stream' },
    body,
  });
}

function rawPutHead(accountId: string, token: string, contentLength: number): string {
  return (
    `PUT /v1/backups/${accountId} HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
    `Authorization: Bearer ${token}\r\nContent-Length: ${contentLength}\r\n\r\n`
  );
}

describe('real HTTP server', () => {
  it('streams downloads with a Content-Length, and answers HEAD without a body', async () => {
    server = await startTestServer({ dataDir });
    const accountId = hex64();
    const token = hex64();
    const payload = randomBytes(300_000);
    expect((await put(server, accountId, token, payload)).status).toBe(201);

    const res = await fetch(`${server.url}/v1/backups/${accountId}/latest`, {
      headers: auth(token),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('300000');
    expect(Buffer.from(await res.arrayBuffer()).equals(payload)).toBe(true);

    const head = await fetch(`${server.url}/v1/backups/${accountId}/latest`, {
      method: 'HEAD',
      headers: auth(token),
    });
    expect(head.headers.get('content-length')).toBe('300000');
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });

  it('cleans up after a client that disconnects mid-upload, and refunds the attempt', async () => {
    server = await startTestServer({
      dataDir,
      limits: { ...DEFAULT_LIMITS, writesPerAccountPerMinute: 1 },
    });
    const s = server;
    const accountId = hex64();
    const token = hex64();
    const raw = await openRawRequest(s.port, rawPutHead(accountId, token, 100_000), bytes(1000));
    await waitFor(async () => (await listDir(path.join(dataDir, 'incoming'))).length > 0);

    raw.socket.destroy(); // signal lost
    const logLine = `PUT /v1/backups/${accountId.slice(0, 8)}... 400 `;
    await waitFor(() => s.logs.some((line) => line.startsWith(logLine)));
    expect(await listDir(path.join(dataDir, 'incoming'))).toEqual([]);
    expect(await listDir(path.join(dataDir, 'accounts'))).toEqual([]);

    // The broken attempt didn't use up the single upload per minute allowed here.
    expect((await put(s, accountId, token, bytes(8))).status).toBe(201);
    expect((await put(s, accountId, token, bytes(8))).status).toBe(429);
  });

  it('answers 507 when the disk is low, while restores keep working', async () => {
    let space = { freeBytes: 900, totalBytes: 1000 };
    server = await startTestServer({ dataDir, diskSpace: () => Promise.resolve(space) });
    const accountId = hex64();
    const token = hex64();
    expect((await put(server, accountId, token, bytes(64, 3))).status).toBe(201);

    space = { freeBytes: 100, totalBytes: 1000 };
    const refused = await put(server, accountId, token, bytes(64, 4));
    expect(refused.status).toBe(507);
    expect(await refused.json()).toEqual({ error: 'insufficient_storage' });

    const latest = await fetch(`${server.url}/v1/backups/${accountId}/latest`, {
      headers: auth(token),
    });
    expect(latest.status).toBe(200);
    expect(new Uint8Array(await latest.arrayBuffer())).toEqual(bytes(64, 3));
  });

  it('does not let a stalled upload block the account, and cuts it off at the timeout', async () => {
    server = await startTestServer({ dataDir, requestTimeoutMs: 2000 });
    const s = server;
    const accountId = hex64();
    const token = hex64();
    expect((await put(s, accountId, token, bytes(8, 1))).status).toBe(201);

    // A phone loses signal mid-upload: headers and 100 of 5000 bytes, then nothing.
    const stalled = await openRawRequest(s.port, rawPutHead(accountId, token, 5000), bytes(100));
    await waitFor(async () => (await listDir(path.join(dataDir, 'incoming'))).length > 0);

    const started = Date.now();
    expect((await put(s, accountId, token, bytes(8, 2))).status).toBe(201);
    expect(Date.now() - started).toBeLessThan(1000); // not waiting for the stalled upload

    await stalled.closed; // Node answers 408 and closes after requestTimeoutMs
    expect(stalled.received()).toMatch(/^HTTP\/1\.1 408/);
    await waitFor(async () => (await listDir(path.join(dataDir, 'incoming'))).length === 0);
    const list = await fetch(`${s.url}/v1/backups/${accountId}`, { headers: auth(token) });
    expect(((await list.json()) as { versions: unknown[] }).versions).toHaveLength(2);
  });
});

/** Fills the filesystem holding `dir` until writes fail with ENOSPC. */
async function fillDisk(dir: string): Promise<void> {
  const handle = await open(path.join(dir, 'filler'), 'w');
  try {
    for (const chunkSize of [65_536, 4096, 1]) {
      const chunk = new Uint8Array(chunkSize);
      for (;;) {
        try {
          await handle.write(chunk);
        } catch (err) {
          if (isErrno(err, 'ENOSPC')) break;
          throw err;
        }
      }
    }
  } finally {
    await handle.close();
  }
}

describe('on a real, completely full disk', () => {
  it('starts, keeps serving restores and refuses uploads with 507', async (ctx) => {
    // Needs a small real filesystem: a 2 MB tmpfs. Mounting needs root (CAP_SYS_ADMIN), so
    // this runs in privileged dev containers and is skipped elsewhere (e.g. GitHub runners).
    if (process.platform !== 'linux' || process.getuid?.() !== 0) ctx.skip();
    const disk = await makeTempDir();
    try {
      execFileSync('mount', ['-t', 'tmpfs', '-o', 'size=2m', 'tmpfs', disk], { stdio: 'ignore' });
    } catch {
      await rm(disk, { recursive: true, force: true });
      ctx.skip();
    }
    try {
      const accountId = hex64();
      const token = hex64();
      const payload = randomBytes(100_000);
      const real = { dataDir: disk, diskSpace: readDiskSpace };

      let s = await startTestServer(real);
      expect((await put(s, accountId, token, payload)).status).toBe(201);
      await s.close();

      await fillDisk(disk);
      expect((await readDiskSpace(disk)).freeBytes).toBe(0);

      // Restart on the full disk.
      s = await startTestServer(real);
      server = s;
      expect((await fetch(`${s.url}/health`)).status).toBe(200);
      const latest = await fetch(`${s.url}/v1/backups/${accountId}/latest`, {
        headers: auth(token),
      });
      expect(latest.status).toBe(200);
      expect(Buffer.from(await latest.arrayBuffer()).equals(payload)).toBe(true);
      const refused = await put(s, accountId, token, bytes(1000));
      expect(refused.status).toBe(507);
      expect(await refused.json()).toEqual({ error: 'insufficient_storage' });
      await s.close();
      server = undefined;

      // With the reserve check off, the write itself hits ENOSPC: still a clean 507.
      s = await startTestServer({ ...real, limits: { ...DEFAULT_LIMITS, minFreeDiskPercent: 0 } });
      server = s;
      const enospc = await put(s, accountId, token, bytes(100_000));
      expect(enospc.status).toBe(507);
      expect(await listDir(path.join(disk, 'incoming'))).toEqual([]);
      expect(
        (await fetch(`${s.url}/v1/backups/${accountId}`, { headers: auth(token) })).status,
      ).toBe(200);
    } finally {
      await server?.close();
      server = undefined;
      execFileSync('umount', [disk], { stdio: 'ignore' });
      await rm(disk, { recursive: true, force: true });
    }
  });
});
