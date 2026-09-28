import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Harness } from './helpers.js';
import {
  START,
  auth,
  bytes,
  createHarness,
  getWithToken,
  hex64,
  listDir,
  putBackup,
  uploadOk,
} from './helpers.js';

const VERSION_RE = /^\d{8}T\d{9}Z-[0-9a-f]{8}$/;

let h: Harness;
let accountId: string;
let token: string;

beforeEach(async () => {
  h = await createHarness();
  accountId = hex64();
  token = hex64();
});

afterEach(async () => {
  await h.cleanup();
});

describe('GET /health', () => {
  it('returns ok without auth', async () => {
    const res = await h.app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('PUT /v1/backups/:accountId', () => {
  it('creates the account on first upload and stores the bytes verbatim', async () => {
    const payload = new Uint8Array([0, 1, 2, 250, 251, 252, 255]);
    const res = await putBackup(h.app, accountId, token, payload);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { version: string; createdAt: string; size: number };
    expect(body.version).toMatch(VERSION_RE);
    expect(body.createdAt).toBe(new Date(START).toISOString());
    expect(body.size).toBe(payload.byteLength);

    const accountDir = path.join(h.dataDir, 'accounts', accountId);
    const stored = await readFile(path.join(accountDir, 'versions', `${body.version}.bin`));
    expect(new Uint8Array(stored)).toEqual(payload);

    // Only the token's hash is stored.
    const authFile = await readFile(path.join(accountDir, 'auth.json'), 'utf8');
    expect(authFile).not.toContain(token);
    expect(JSON.parse(authFile)).toMatchObject({
      tokenSha256: createHash('sha256').update(token).digest('hex'),
    });
  });

  it('adds a new, later version on each upload with the same token', async () => {
    const first = await uploadOk(h.app, accountId, token, bytes(10, 1));
    h.clock.advance(60_000);
    const second = await uploadOk(h.app, accountId, token, bytes(20, 2));
    expect(second.version > first.version).toBe(true);
    expect(second.size).toBe(20);
  });

  it('gives distinct, increasing versions to uploads within the same millisecond', async () => {
    const a = await uploadOk(h.app, accountId, token, bytes(1));
    const b = await uploadOk(h.app, accountId, token, bytes(2));
    expect(b.version > a.version).toBe(true);
    expect(Date.parse(b.createdAt) - Date.parse(a.createdAt)).toBe(1);
  });

  it('rejects a different token for an existing account with 401', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    const res = await putBackup(h.app, accountId, hex64(), bytes(10, 9));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(await listDir(path.join(h.dataDir, 'accounts', accountId, 'versions'))).toHaveLength(1);
  });

  it('requires a bearer token', async () => {
    const res = await h.app.request(`/v1/backups/${accountId}`, { method: 'PUT', body: bytes(5) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'missing_token' });
  });

  it('rejects an empty body without creating the account', async () => {
    const res = await putBackup(h.app, accountId, token, new Uint8Array(0));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'empty_body' });
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
  });
});

describe('GET /v1/backups/:accountId', () => {
  it('lists versions newest first', async () => {
    const first = await uploadOk(h.app, accountId, token, bytes(100));
    h.clock.advance(1000);
    const second = await uploadOk(h.app, accountId, token, bytes(200));

    const res = await getWithToken(h.app, `/v1/backups/${accountId}`, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      versions: [
        { version: second.version, createdAt: second.createdAt, size: 200 },
        { version: first.version, createdAt: first.createdAt, size: 100 },
      ],
    });
  });

  it('answers an unknown account exactly like a wrong token (401, no enumeration)', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    const wrongToken = await getWithToken(h.app, `/v1/backups/${accountId}`, hex64());
    const unknownAccount = await getWithToken(h.app, `/v1/backups/${hex64()}`, token);
    expect(wrongToken.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(await unknownAccount.json()).toEqual(await wrongToken.json());
  });
});

describe('GET /v1/backups/:accountId/latest', () => {
  it('returns the newest blob with version headers', async () => {
    await uploadOk(h.app, accountId, token, bytes(10, 1));
    h.clock.advance(60_000);
    const newest = await uploadOk(h.app, accountId, token, bytes(12, 2));

    const res = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('X-Backup-Version')).toBe(newest.version);
    expect(res.headers.get('X-Backup-Created-At')).toBe(newest.createdAt);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(12, 2));
  });

  it('is 401 for an unknown account and for a wrong token', async () => {
    expect((await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token)).status).toBe(401);
    await uploadOk(h.app, accountId, token, bytes(10));
    expect((await getWithToken(h.app, `/v1/backups/${accountId}/latest`, hex64())).status).toBe(
      401,
    );
  });

  it('is 404 when the account has no versions', async () => {
    // Simulates a crash after the account was claimed but before its first version landed.
    const upload = await uploadOk(h.app, accountId, token, bytes(10));
    await rm(path.join(h.dataDir, 'accounts', accountId, 'versions', `${upload.version}.bin`));

    const res = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('GET /v1/backups/:accountId/:version', () => {
  it('returns that specific version', async () => {
    const older = await uploadOk(h.app, accountId, token, bytes(10, 1));
    h.clock.advance(60_000);
    await uploadOk(h.app, accountId, token, bytes(12, 2));

    const res = await getWithToken(h.app, `/v1/backups/${accountId}/${older.version}`, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Backup-Version')).toBe(older.version);
    expect(res.headers.get('X-Backup-Created-At')).toBe(older.createdAt);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(10, 1));
  });

  it('is 404 for a well-formed version that does not exist', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    const res = await getWithToken(
      h.app,
      `/v1/backups/${accountId}/20200101T000000000Z-00000000`,
      token,
    );
    expect(res.status).toBe(404);
  });

  it('is 401 (not 404) for a version of an account the caller cannot access', async () => {
    const upload = await uploadOk(h.app, accountId, token, bytes(10));
    const res = await getWithToken(h.app, `/v1/backups/${accountId}/${upload.version}`, hex64());
    expect(res.status).toBe(401);
  });
});

describe('DELETE /v1/backups/:accountId', () => {
  it('deletes the account and every version', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    await uploadOk(h.app, accountId, token, bytes(11));

    const res = await h.app.request(`/v1/backups/${accountId}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
    expect(await listDir(path.join(h.dataDir, 'trash'))).toEqual([]);

    // The account is gone: reads now look exactly like any unknown account.
    expect((await getWithToken(h.app, `/v1/backups/${accountId}`, token)).status).toBe(401);
    // ...and a repeated DELETE is a 401 as well.
    const again = await h.app.request(`/v1/backups/${accountId}`, {
      method: 'DELETE',
      headers: auth(token),
    });
    expect(again.status).toBe(401);
  });

  it('refuses a wrong token and keeps the data', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    const res = await h.app.request(`/v1/backups/${accountId}`, {
      method: 'DELETE',
      headers: auth(hex64()),
    });
    expect(res.status).toBe(401);
    expect((await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token)).status).toBe(200);
  });

  it('frees the id so a later upload starts a fresh account', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    await h.app.request(`/v1/backups/${accountId}`, { method: 'DELETE', headers: auth(token) });
    const newToken = hex64();
    await uploadOk(h.app, accountId, newToken, bytes(3));
    const list = await getWithToken(h.app, `/v1/backups/${accountId}`, newToken);
    expect(((await list.json()) as { versions: unknown[] }).versions).toHaveLength(1);
  });
});

describe('input validation', () => {
  const badAccountIds = [
    'abc',
    'A'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    `${'a'.repeat(63)}g`,
    '..%2F..%2Fetc%2Fpasswd',
    `..%2F${'a'.repeat(64)}`,
    `${'a'.repeat(64)}%00`,
    '%2e%2e%2f%2e%2e%2faccounts',
  ];

  it.each(badAccountIds)('rejects account id %j with 400 on every route', async (id) => {
    const t = hex64();
    const responses = [
      await h.app.request(`/v1/backups/${id}`, { method: 'PUT', body: bytes(4), headers: auth(t) }),
      await h.app.request(`/v1/backups/${id}`, { headers: auth(t) }),
      await h.app.request(`/v1/backups/${id}/latest`, { headers: auth(t) }),
      await h.app.request(`/v1/backups/${id}/20260101T000000000Z-00000000`, { headers: auth(t) }),
      await h.app.request(`/v1/backups/${id}`, { method: 'DELETE', headers: auth(t) }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_account_id' });
    }
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
  });

  it.each([
    'Bearer abc',
    `Bearer ${'A'.repeat(64)}`,
    `Bearer ${'a'.repeat(63)}`,
    `Bearer ${'a'.repeat(65)}`,
    `Basic ${'a'.repeat(64)}`,
    'a'.repeat(64),
  ])('rejects Authorization %j with 400', async (header) => {
    const put = await h.app.request(`/v1/backups/${accountId}`, {
      method: 'PUT',
      body: bytes(4),
      headers: { Authorization: header },
    });
    expect(put.status).toBe(400);
    expect(await put.json()).toEqual({ error: 'invalid_token' });
    const list = await h.app.request(`/v1/backups/${accountId}`, {
      headers: { Authorization: header },
    });
    expect(list.status).toBe(400);
  });

  it.each([
    'nope',
    '20260101T000000000Z',
    '20260101T000000000Z-0000000G',
    '20261301T000000000Z-00000000',
    '..%2Fauth.json',
    '%2e%2e%2fauth.json',
    '20260101T000000000Z-00000000%2F..%2F..%2Fauth.json',
    '20260101T000000000Z-00000000.bin',
  ])('rejects version %j with 400', async (version) => {
    await uploadOk(h.app, accountId, token, bytes(4));
    const res = await getWithToken(h.app, `/v1/backups/${accountId}/${version}`, token);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_version' });
  });

  it('never serves files outside the requested account (dot segments are normalized away)', async () => {
    await uploadOk(h.app, accountId, token, bytes(4));
    for (const url of [
      `/v1/backups/${accountId}/../../../etc/passwd`,
      `/v1/backups/${accountId}/%2e%2e/auth.json`,
      `/v1/backups/${accountId}/versions/..`,
    ]) {
      const res = await getWithToken(h.app, url, token);
      expect([400, 401, 404]).toContain(res.status);
      expect(res.headers.get('Content-Type')).not.toBe('application/octet-stream');
    }
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await h.app.request('/v2/whatever');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
