import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Harness } from './helpers.js';
import {
  auth,
  bytes,
  createHarness,
  getWithToken,
  hex64,
  listDir,
  putBackup,
  uploadOk,
} from './helpers.js';

const MiB = 1024 * 1024;

let h: Harness | undefined;

async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  h = await createHarness(options);
  return h;
}

afterEach(async () => {
  await h?.cleanup();
  h = undefined;
});

/** A body stream with no Content-Length that records how much of it was pulled. */
function countingStream(chunkSize: number, chunks: number) {
  const counter = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (counter.pulled >= chunks) {
        controller.close();
        return;
      }
      counter.pulled += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(1));
    },
  });
  return { stream, counter };
}

describe('body size limit (413)', () => {
  it('accepts exactly the default 10 MB and rejects one byte more', async () => {
    const { app, dataDir } = await harness();
    const accountId = hex64();
    const token = hex64();

    const atLimit = await putBackup(app, accountId, token, bytes(10 * MiB));
    expect(atLimit.status).toBe(201);

    const overLimit = await putBackup(app, accountId, token, bytes(10 * MiB + 1));
    expect(overLimit.status).toBe(413);
    expect(await overLimit.json()).toEqual({ error: 'payload_too_large' });
    expect(await listDir(path.join(dataDir, 'accounts', accountId, 'versions'))).toHaveLength(1);
  });

  it('refuses up front when Content-Length announces an oversized body', async () => {
    const { app, dataDir } = await harness({ limits: { maxBodyBytes: 1024 } });
    const { stream, counter } = countingStream(512, 10);
    const res = await app.request(`/v1/backups/${hex64()}`, {
      method: 'PUT',
      body: stream,
      duplex: 'half',
      headers: { ...auth(hex64()), 'Content-Length': String(512 * 10) },
    });
    expect(res.status).toBe(413);
    expect(counter.pulled).toBeLessThanOrEqual(1); // never read
    expect(await listDir(path.join(dataDir, 'accounts'))).toEqual([]);
  });

  it('stops reading a streamed body as soon as it passes the limit', async () => {
    const { app, dataDir } = await harness({ limits: { maxBodyBytes: 1024 } });
    const accountId = hex64();
    const { stream, counter } = countingStream(256, 1000); // 256 KB offered, 1 KB allowed
    const res = await app.request(`/v1/backups/${accountId}`, {
      method: 'PUT',
      body: stream,
      duplex: 'half',
      headers: auth(hex64()),
    });
    expect(res.status).toBe(413);
    expect(counter.pulled).toBeLessThan(10); // stopped after ~5 chunks, not 1000
    // Nothing left behind: no temp file, no half-created account.
    expect(await listDir(path.join(dataDir, 'accounts'))).toEqual([]);
  });

  it('keeps existing versions intact when an oversized upload is rejected', async () => {
    const { app, dataDir } = await harness({ limits: { maxBodyBytes: 1024 } });
    const accountId = hex64();
    const token = hex64();
    await uploadOk(app, accountId, token, bytes(1024));
    const { stream } = countingStream(256, 100);
    const res = await app.request(`/v1/backups/${accountId}`, {
      method: 'PUT',
      body: stream,
      duplex: 'half',
      headers: auth(token),
    });
    expect(res.status).toBe(413);
    const versionsDir = path.join(dataDir, 'accounts', accountId, 'versions');
    expect(await listDir(versionsDir)).toHaveLength(1);
    expect((await getWithToken(app, `/v1/backups/${accountId}/latest`, token)).status).toBe(200);
  });
});

describe('rate limiting (429)', () => {
  it('limits requests per client IP, using Fly-Client-IP', async () => {
    const { app, clock } = await harness({ limits: { requestsPerIpPerMinute: 5 } });
    const from = (ip: string) => ({ 'Fly-Client-IP': ip });
    const token = hex64();
    const url = `/v1/backups/${hex64()}`;

    for (let i = 0; i < 5; i += 1) {
      expect((await getWithToken(app, url, token, from('203.0.113.1'))).status).toBe(401);
    }
    const limited = await getWithToken(app, url, token, from('203.0.113.1'));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toBe('60');

    // Other clients are unaffected; the health check is never limited.
    expect((await getWithToken(app, url, token, from('203.0.113.2'))).status).toBe(401);
    expect((await app.request('/health', { headers: from('203.0.113.1') })).status).toBe(200);

    clock.advance(60_000);
    expect((await getWithToken(app, url, token, from('203.0.113.1'))).status).toBe(401);
  });

  it('treats a whole IPv6 /64 as one client', async () => {
    const { app } = await harness({ limits: { requestsPerIpPerMinute: 2 } });
    const hit = (ip: string) => app.request('/v2/nothing', { headers: { 'Fly-Client-IP': ip } });
    expect((await hit('2001:db8:1:2::1')).status).toBe(404);
    expect((await hit('2001:db8:1:2::ffff')).status).toBe(404);
    expect((await hit('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).status).toBe(429);
    expect((await hit('2001:db8:1:3::1')).status).toBe(404);
  });

  it('limits uploads per account', async () => {
    const { app, clock } = await harness({ limits: { writesPerAccountPerMinute: 3 } });
    const accountId = hex64();
    const token = hex64();
    for (let i = 0; i < 3; i += 1) await uploadOk(app, accountId, token, bytes(8));

    const limited = await putBackup(app, accountId, token, bytes(8));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);

    // Reads and other accounts are unaffected.
    expect((await getWithToken(app, `/v1/backups/${accountId}/latest`, token)).status).toBe(200);
    await uploadOk(app, hex64(), hex64(), bytes(8));

    clock.advance(60_000);
    await uploadOk(app, accountId, token, bytes(8));
  });

  it("does not let a wrong token use up the owner's upload allowance", async () => {
    const { app } = await harness({ limits: { writesPerAccountPerMinute: 2 } });
    const accountId = hex64();
    const token = hex64();
    await uploadOk(app, accountId, token, bytes(8));
    for (let i = 0; i < 5; i += 1) {
      expect((await putBackup(app, accountId, hex64(), bytes(8))).status).toBe(401);
    }
    await uploadOk(app, accountId, token, bytes(8));
  });

  it('limits how many new accounts one client can create per hour', async () => {
    const { app, clock } = await harness({ limits: { newAccountsPerIpPerHour: 2 } });
    const ip = { 'Fly-Client-IP': '198.51.100.9' };
    const existing = { id: hex64(), token: hex64() };
    await uploadOk(app, existing.id, existing.token, bytes(8), ip);
    await uploadOk(app, hex64(), hex64(), bytes(8), ip);

    const third = await putBackup(app, hex64(), hex64(), bytes(8), ip);
    expect(third.status).toBe(429);

    // Existing accounts keep working, and other clients can still sign up.
    await uploadOk(app, existing.id, existing.token, bytes(8), ip);
    await uploadOk(app, hex64(), hex64(), bytes(8), { 'Fly-Client-IP': '198.51.100.10' });

    clock.advance(60 * 60_000);
    await uploadOk(app, hex64(), hex64(), bytes(8), ip);
  });
});
