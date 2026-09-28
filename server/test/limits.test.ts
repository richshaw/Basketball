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
  statusOf,
  uploadOk,
} from './helpers.js';

const MiB = 1024 * 1024;
const DAY = 86_400_000;

const harnesses: Harness[] = [];

async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
  const h = await createHarness(options);
  harnesses.push(h);
  return h;
}

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.cleanup();
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

/** A body that sends a few bytes and then breaks, like a phone losing signal mid-upload. */
function brokenStream(): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent) {
        controller.error(new Error('connection lost'));
        return;
      }
      sent = true;
      controller.enqueue(bytes(100));
    },
  });
}

function putStream(h: Harness, accountId: string, token: string, body: ReadableStream) {
  return h.app.request(`/v1/backups/${accountId}`, {
    method: 'PUT',
    body,
    duplex: 'half',
    headers: auth(token),
  });
}

async function listedSizes(h: Harness, accountId: string, token: string): Promise<number[]> {
  const res = await getWithToken(h.app, `/v1/backups/${accountId}`, token);
  const body = (await res.json()) as { versions: { size: number }[] };
  return body.versions.map((v) => v.size);
}

describe('body size limit (413)', () => {
  it('accepts exactly the default 5 MiB and rejects one byte more', async () => {
    const h = await harness();
    const accountId = hex64();
    const token = hex64();

    expect((await putBackup(h.app, accountId, token, bytes(5 * MiB))).status).toBe(201);

    const overLimit = await putBackup(h.app, accountId, token, bytes(5 * MiB + 1));
    expect(overLimit.status).toBe(413);
    expect(await overLimit.json()).toEqual({ error: 'payload_too_large' });
    expect(await listDir(path.join(h.dataDir, 'accounts', accountId, 'versions'))).toHaveLength(1);
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
  });

  it('refuses up front when Content-Length announces an oversized body', async () => {
    const h = await harness({ limits: { maxBodyBytes: 1024 } });
    const { stream, counter } = countingStream(512, 10);
    const res = await h.app.request(`/v1/backups/${hex64()}`, {
      method: 'PUT',
      body: stream,
      duplex: 'half',
      headers: { ...auth(hex64()), 'Content-Length': String(512 * 10) },
    });
    expect(res.status).toBe(413);
    expect(counter.pulled).toBeLessThanOrEqual(1); // never read
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
  });

  it('stops reading a streamed body as soon as it passes the limit', async () => {
    const h = await harness({ limits: { maxBodyBytes: 1024 } });
    const { stream, counter } = countingStream(256, 1000); // 256 KB offered, 1 KB allowed
    const res = await putStream(h, hex64(), hex64(), stream);
    expect(res.status).toBe(413);
    expect(counter.pulled).toBeLessThan(10); // stopped after ~5 chunks, not 1000
    // Nothing left behind: no partial upload, no half-created account.
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
  });

  it('keeps existing versions intact when an oversized upload is rejected', async () => {
    const h = await harness({ limits: { maxBodyBytes: 1024 } });
    const accountId = hex64();
    const token = hex64();
    await uploadOk(h.app, accountId, token, bytes(1024));
    const { stream } = countingStream(256, 100);
    expect((await putStream(h, accountId, token, stream)).status).toBe(413);
    expect(await listedSizes(h, accountId, token)).toEqual([1024]);
  });
});

describe('per-account storage budget', () => {
  it('drops the oldest versions to stay within MAX_ACCOUNT_BYTES', async () => {
    const h = await harness({ limits: { maxAccountBytes: 100, maxBodyBytes: 40 } });
    const accountId = hex64();
    const token = hex64();
    for (const size of [30, 30, 30]) await uploadOk(h.app, accountId, token, bytes(size));
    expect(await listedSizes(h, accountId, token)).toEqual([30, 30, 30]);

    await uploadOk(h.app, accountId, token, bytes(31));
    expect(await listedSizes(h, accountId, token)).toEqual([31, 30, 30]); // 121 > 100: oldest out

    await uploadOk(h.app, accountId, token, bytes(40));
    expect(await listedSizes(h, accountId, token)).toEqual([40, 31]); // 40 + 31 + 30 > 100
  });
});

describe('account caps', () => {
  it('holds at most MAX_ACCOUNTS accounts (507), and deleting one frees its slot', async () => {
    const h = await harness({ limits: { maxAccounts: 2 } });
    const a = { id: hex64(), token: hex64() };
    await uploadOk(h.app, a.id, a.token, bytes(8));
    await uploadOk(h.app, hex64(), hex64(), bytes(8));

    const third = await putBackup(h.app, hex64(), hex64(), bytes(8));
    expect(third.status).toBe(507);
    expect(await third.json()).toEqual({ error: 'account_limit_reached' });
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toHaveLength(2);
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);

    // Existing accounts are unaffected.
    await uploadOk(h.app, a.id, a.token, bytes(8));

    await h.app.request(`/v1/backups/${a.id}`, { method: 'DELETE', headers: auth(a.token) });
    await uploadOk(h.app, hex64(), hex64(), bytes(8));
  });

  it('allows MAX_NEW_ACCOUNTS_PER_DAY new accounts per 24 hours, across restarts', async () => {
    const h = await harness({ limits: { maxNewAccountsPerDay: 2 } });
    const first = { id: hex64(), token: hex64() };
    await uploadOk(h.app, first.id, first.token, bytes(8));
    h.clock.advance(60 * 60_000);
    await uploadOk(h.app, hex64(), hex64(), bytes(8));

    const limited = await putBackup(h.app, hex64(), hex64(), bytes(8));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    // The first creation ages out of the 24h window 23 hours from now.
    expect(Number(limited.headers.get('Retry-After'))).toBe(23 * 60 * 60);

    // Deleting doesn't give the day's allowance back...
    await h.app.request(`/v1/backups/${first.id}`, {
      method: 'DELETE',
      headers: auth(first.token),
    });
    expect((await putBackup(h.app, hex64(), hex64(), bytes(8))).status).toBe(429);

    // ...and a restart (the machine stops when idle) doesn't reset it either.
    const restarted = await createHarness({
      dataDir: h.dataDir,
      limits: { maxNewAccountsPerDay: 2 },
    });
    restarted.clock.ms = h.clock.ms;
    expect((await putBackup(restarted.app, hex64(), hex64(), bytes(8))).status).toBe(429);

    restarted.clock.advance(DAY);
    await uploadOk(restarted.app, hex64(), hex64(), bytes(8));
  });

  it('only counts accounts that were actually created', async () => {
    const h = await harness({ limits: { maxNewAccountsPerDay: 1 } });
    const id = hex64();
    const token = hex64();
    expect((await putStream(h, id, token, brokenStream())).status).toBe(400);
    expect((await putBackup(h.app, id, token, new Uint8Array(0))).status).toBe(400);
    await uploadOk(h.app, id, token, bytes(8));
  });
});

describe('disk space guard (507)', () => {
  const lowSpace = () => Promise.resolve({ freeBytes: 150, totalBytes: 1000 }); // 15% free

  it('refuses uploads and new accounts below the reserve, but reads keep working', async () => {
    let space = { freeBytes: 900, totalBytes: 1000 };
    const h = await harness({ diskSpace: () => Promise.resolve(space) });
    const accountId = hex64();
    const token = hex64();
    await uploadOk(h.app, accountId, token, bytes(8, 1));

    space = { freeBytes: 199, totalBytes: 1000 }; // below the default 20%
    const upload = await putBackup(h.app, accountId, token, bytes(8, 2));
    expect(upload.status).toBe(507);
    expect(await upload.json()).toEqual({ error: 'insufficient_storage' });
    expect((await putBackup(h.app, hex64(), hex64(), bytes(8))).status).toBe(507);

    const latest = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
    expect(latest.status).toBe(200);
    expect(new Uint8Array(await latest.arrayBuffer())).toEqual(bytes(8, 1));
    expect((await getWithToken(h.app, `/v1/backups/${accountId}`, token)).status).toBe(200);
    const deleted = await h.app.request(`/v1/backups/${accountId}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(deleted.status).toBe(204);
  });

  it('can be switched off with MIN_FREE_DISK_PERCENT=0', async () => {
    const h = await harness({ diskSpace: lowSpace, limits: { minFreeDiskPercent: 0 } });
    await uploadOk(h.app, hex64(), hex64(), bytes(8));
  });

  it('lets uploads through (and logs) when free space cannot be determined', async () => {
    const h = await harness({ diskSpace: () => Promise.reject(new Error('statfs unsupported')) });
    await uploadOk(h.app, hex64(), hex64(), bytes(8));
    expect(h.logs.join('\n')).toContain('disk space check failed');
  });
});

describe('concurrent uploads', () => {
  /** Starts an upload that stalls after 10 bytes (from `ip`); resolves once it is under way. */
  async function startStalledUpload(h: Harness, id: string, token: string, ip: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(10));
      },
      async pull(controller) {
        await gate;
        controller.close();
      },
    });
    const incoming = path.join(h.dataDir, 'incoming');
    const before = (await listDir(incoming)).length;
    const response = Promise.resolve(
      h.app.request(`/v1/backups/${id}`, {
        method: 'PUT',
        body,
        duplex: 'half',
        headers: { ...auth(token), 'Fly-Client-IP': ip },
      }),
    );
    for (let i = 0; (await listDir(incoming)).length <= before; i += 1) {
      if (i > 400) throw new Error('upload never started');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { response, release };
  }

  it("keeps strangers' stalled first uploads from taking the family's upload slots", async () => {
    const h = await harness(); // 4 slots, of which first uploads to unknown ids may use 1
    const family = { id: hex64(), token: hex64() };
    await uploadOk(h.app, family.id, family.token, bytes(8));

    const stranger = await startStalledUpload(h, hex64(), hex64(), '203.0.113.9');
    const another = await putBackup(h.app, hex64(), hex64(), bytes(8), {
      'Fly-Client-IP': '203.0.113.10',
    });
    expect(another.status).toBe(503);
    expect(await another.json()).toEqual({ error: 'server_busy' });
    expect(another.headers.get('Retry-After')).toBe('5');

    // The family's existing account still has its slots.
    await uploadOk(h.app, family.id, family.token, bytes(8), { 'Fly-Client-IP': '198.51.100.1' });

    stranger.release();
    expect((await stranger.response).status).toBe(201);
  });

  it('turns away uploads beyond MAX_CONCURRENT_UPLOADS with 503', async () => {
    const h = await harness({ limits: { maxConcurrentUploads: 2 } });
    const accounts = [0, 1, 2].map(() => ({ id: hex64(), token: hex64() }));
    for (const a of accounts) await uploadOk(h.app, a.id, a.token, bytes(8));

    const [a, b, c] = accounts as [
      (typeof accounts)[0],
      (typeof accounts)[0],
      (typeof accounts)[0],
    ];
    const first = await startStalledUpload(h, a.id, a.token, '198.51.100.1');
    const second = await startStalledUpload(h, b.id, b.token, '198.51.100.2');
    const busy = await putBackup(h.app, c.id, c.token, bytes(8), {
      'Fly-Client-IP': '198.51.100.3',
    });
    expect(busy.status).toBe(503);

    first.release();
    second.release();
    expect((await first.response).status).toBe(201);
    expect((await second.response).status).toBe(201);
    await uploadOk(h.app, c.id, c.token, bytes(8));
  });

  it('limits concurrent uploads per client IP (429)', async () => {
    const h = await harness({ limits: { maxConcurrentUploadsPerIp: 2 } });
    const accounts = [0, 1, 2].map(() => ({ id: hex64(), token: hex64() }));
    for (const a of accounts) await uploadOk(h.app, a.id, a.token, bytes(8));
    const [a, b, c] = accounts as [
      (typeof accounts)[0],
      (typeof accounts)[0],
      (typeof accounts)[0],
    ];

    const first = await startStalledUpload(h, a.id, a.token, '198.51.100.7');
    const second = await startStalledUpload(h, b.id, b.token, '198.51.100.7');
    const limited = await putBackup(h.app, c.id, c.token, bytes(8), {
      'Fly-Client-IP': '198.51.100.7',
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toBe('5');
    // Other clients are unaffected.
    await uploadOk(h.app, c.id, c.token, bytes(8), { 'Fly-Client-IP': '198.51.100.8' });

    first.release();
    second.release();
    await Promise.all([first.response, second.response]);
  });

  it('drops an upload whose body stops arriving (408) and frees its slot', async () => {
    const h = await harness({
      limits: { uploadStallTimeoutMs: 150, writesPerAccountPerMinute: 1, maxConcurrentUploads: 2 },
    });
    const id = hex64();
    const token = hex64();
    const stalled = await startStalledUpload(h, id, token, '198.51.100.1');

    const res = await stalled.response; // never released: the server gives up on its own
    expect(res.status).toBe(408);
    expect(await res.json()).toEqual({ error: 'upload_stalled' });
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
    // The slot and the upload allowance are both back.
    await uploadOk(h.app, id, token, bytes(8), { 'Fly-Client-IP': '198.51.100.1' });
    stalled.release();
  });
});

describe('rate limiting (429)', () => {
  it('limits requests per client IP, using Fly-Client-IP', async () => {
    const h = await harness({ limits: { requestsPerIpPerMinute: 5 } });
    const from = (ip: string) => ({ 'Fly-Client-IP': ip });
    const token = hex64();
    const url = `/v1/backups/${hex64()}`;

    for (let i = 0; i < 5; i += 1) {
      expect((await getWithToken(h.app, url, token, from('203.0.113.1'))).status).toBe(401);
    }
    const limited = await getWithToken(h.app, url, token, from('203.0.113.1'));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'rate_limited' });
    expect(limited.headers.get('Retry-After')).toBe('60');

    // Other clients are unaffected; the health check is never limited.
    expect((await getWithToken(h.app, url, token, from('203.0.113.2'))).status).toBe(401);
    expect((await h.app.request('/health', { headers: from('203.0.113.1') })).status).toBe(200);

    h.clock.advance(60_000);
    expect((await getWithToken(h.app, url, token, from('203.0.113.1'))).status).toBe(401);
  });

  it('treats a whole IPv6 /64 as one client', async () => {
    const h = await harness({ limits: { requestsPerIpPerMinute: 2 } });
    const hit = (ip: string) => h.app.request('/v2/nothing', { headers: { 'Fly-Client-IP': ip } });
    expect((await hit('2001:db8:1:2::1')).status).toBe(404);
    expect((await hit('2001:db8:1:2::ffff')).status).toBe(404);
    expect((await hit('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).status).toBe(429);
    expect((await hit('2001:db8:1:3::1')).status).toBe(404);
  });

  it('limits uploads per account', async () => {
    const h = await harness({ limits: { writesPerAccountPerMinute: 3 } });
    const accountId = hex64();
    const token = hex64();
    for (let i = 0; i < 3; i += 1) await uploadOk(h.app, accountId, token, bytes(8));

    const limited = await putBackup(h.app, accountId, token, bytes(8));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);

    // Reads and other accounts are unaffected.
    expect(await statusOf(getWithToken(h.app, `/v1/backups/${accountId}/latest`, token))).toBe(200);
    await uploadOk(h.app, hex64(), hex64(), bytes(8));

    h.clock.advance(60_000);
    await uploadOk(h.app, accountId, token, bytes(8));
  });

  it("does not let a wrong token use up the owner's upload allowance", async () => {
    const h = await harness({ limits: { writesPerAccountPerMinute: 2 } });
    const accountId = hex64();
    const token = hex64();
    await uploadOk(h.app, accountId, token, bytes(8));
    for (let i = 0; i < 5; i += 1) {
      expect((await putBackup(h.app, accountId, hex64(), bytes(8))).status).toBe(401);
    }
    await uploadOk(h.app, accountId, token, bytes(8));
  });

  it('gives the allowance back when an upload breaks off (bad signal)', async () => {
    const h = await harness({ limits: { writesPerAccountPerMinute: 1 } });
    const accountId = hex64();
    const token = hex64();
    for (let i = 0; i < 3; i += 1) {
      const res = await putStream(h, accountId, token, brokenStream());
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'body_read_failed' });
    }
    await uploadOk(h.app, accountId, token, bytes(8));
    expect((await putBackup(h.app, accountId, token, bytes(8))).status).toBe(429);
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
  });

  it('limits downloads per account', async () => {
    const h = await harness({ limits: { downloadsPerAccountPerMinute: 2 } });
    const accountId = hex64();
    const token = hex64();
    const upload = await uploadOk(h.app, accountId, token, bytes(8));
    const latest = `/v1/backups/${accountId}/latest`;
    expect(await statusOf(getWithToken(h.app, latest, token))).toBe(200);
    expect(
      await statusOf(getWithToken(h.app, `/v1/backups/${accountId}/${upload.version}`, token)),
    ).toBe(200);
    const limited = await getWithToken(h.app, latest, token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);

    // Listing and other accounts are unaffected; the allowance comes back after a minute.
    expect((await getWithToken(h.app, `/v1/backups/${accountId}`, token)).status).toBe(200);
    const other = { id: hex64(), token: hex64() };
    await uploadOk(h.app, other.id, other.token, bytes(8));
    expect(await statusOf(getWithToken(h.app, `/v1/backups/${other.id}/latest`, other.token))).toBe(
      200,
    );
    h.clock.advance(60_000);
    expect(await statusOf(getWithToken(h.app, latest, token))).toBe(200);
  });
});
