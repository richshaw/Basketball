import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareDataDir } from '../src/store.js';
import type { Harness, UploadResponse } from './helpers.js';
import {
  auth,
  bytes,
  createHarness,
  getWithToken,
  hex64,
  listDir,
  makeTempDir,
  putBackup,
  statusOf,
  uploadOk,
} from './helpers.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// For tests that simulate months of use with hundreds of sequential uploads.
const LONG_TEST_MS = 30_000;

let h: Harness;
let accountId: string;
let token: string;

beforeEach(async () => {
  // Generous upload slots: these tests race uploads on purpose (slots are tested elsewhere).
  h = await createHarness({
    limits: {
      maxConcurrentUploads: 20,
      maxConcurrentNewAccountUploads: 10,
      maxConcurrentUploadsPerIp: 20,
    },
  });
  accountId = hex64();
  token = hex64();
});

afterEach(async () => {
  await h.cleanup();
});

const versionsDir = (): string => path.join(h.dataDir, 'accounts', accountId, 'versions');

async function listedVersions(): Promise<string[]> {
  const res = await getWithToken(h.app, `/v1/backups/${accountId}`, token);
  const body = (await res.json()) as { versions: { version: string }[] };
  return body.versions.map((v) => v.version);
}

/**
 * Starts an upload whose body sends a few bytes, then waits for `release()` before finishing
 * (a phone on a slow connection). Resolves once the upload is under way.
 */
async function startSlowUpload(id: string, tok: string, fill: number) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes(10, fill));
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
      headers: auth(tok),
    }),
  );
  for (let i = 0; (await listDir(incoming)).length <= before; i += 1) {
    if (i > 400) throw new Error('upload never started');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { response, release };
}

function deleteAccount(id: string, tok: string): Promise<Response> {
  return Promise.resolve(
    h.app.request(`/v1/backups/${id}`, { method: 'DELETE', headers: auth(tok) }),
  );
}

describe('retention (integration)', () => {
  it('prunes a long game down to the 20 most recent uploads', async () => {
    const uploads: UploadResponse[] = [];
    for (let i = 0; i < 30; i += 1) {
      uploads.push(await uploadOk(h.app, accountId, token, bytes(16, i)));
      h.clock.advance(MINUTE);
    }
    const expected = uploads
      .slice(-20)
      .map((u) => u.version)
      .reverse();
    expect(await listedVersions()).toEqual(expected);
    expect(await listDir(versionsDir())).toEqual(expected.map((v) => `${v}.bin`).sort());
    // A pruned version is gone for good.
    const pruned = uploads[0]?.version ?? '';
    expect((await getWithToken(h.app, `/v1/backups/${accountId}/${pruned}`, token)).status).toBe(
      404,
    );
  });

  it(
    'keeps one snapshot per upload day for 180 days plus the 20 most recent',
    async () => {
      const { app, clock } = h;
      const [id, tok] = [accountId, token];
      const start = Date.parse('2026-01-01T00:00:00.000Z');
      const byDay = new Map<number, UploadResponse[]>();
      const record = (day: number, upload: UploadResponse): void => {
        byDay.set(day, [...(byDay.get(day) ?? []), upload]);
      };

      // 200 days of use: two uploads most evenings, and a burst of 25 on the final day.
      for (let day = 0; day < 200; day += 1) {
        for (const hour of day % 3 === 0 ? [20] : [19, 21]) {
          clock.ms = start + day * DAY + hour * HOUR;
          record(day, await uploadOk(app, id, tok, bytes(8, day % 256)));
        }
      }
      const finalDay = 200;
      for (let i = 0; i < 25; i += 1) {
        clock.ms = start + finalDay * DAY + 18 * HOUR + i * MINUTE;
        record(finalDay, await uploadOk(app, id, tok, bytes(8)));
      }

      // Expected, computed straight from the rules: the 20 newest uploads, plus the newest upload
      // of each of the last 180 upload days (finalDay - 179 to finalDay).
      const all = [...byDay.values()].flat();
      const recent = all.slice(-20).map((u) => u.version);
      const daily: string[] = [];
      for (let day = finalDay - 179; day <= finalDay; day += 1) {
        const uploads = byDay.get(day);
        const newest = uploads?.[uploads.length - 1];
        if (newest) daily.push(newest.version);
      }
      const expected = [...new Set([...recent, ...daily])].sort().reverse();

      const listed = await listedVersions();
      expect(listed).toEqual(expected);
      expect(listed).toHaveLength(20 + 179);
      expect(await listDir(versionsDir())).toHaveLength(20 + 179);
    },
    LONG_TEST_MS,
  );

  it(
    'survives a clock that jumps ahead: one day at most, no matter how many uploads',
    async () => {
      const { app, clock } = h;
      const [id, tok] = [accountId, token];
      const start = Date.parse('2026-01-01T20:00:00.000Z');
      for (let day = 0; day < 200; day += 1) {
        clock.ms = start + day * DAY;
        await uploadOk(app, id, tok, bytes(8));
      }
      const before = await listedVersions();
      expect(before).toHaveLength(180); // days 20..199

      // The clock jumps five years ahead, and a game's worth of uploads happen there.
      h.clock.ms = start + 199 * DAY + 5 * 365 * DAY;
      const jumped: UploadResponse[] = [];
      for (let i = 0; i < 5; i += 1) {
        jumped.push(await uploadOk(h.app, accountId, token, bytes(8, 1)));
        h.clock.advance(MINUTE);
      }
      // The invented day took one day slot (day 20's); the other 179 days are all still there.
      const jumpedIds = jumped.map((u) => u.version).reverse();
      expect(await listedVersions()).toEqual([...jumpedIds, ...before.slice(0, -1)]);

      // The clock is corrected. New uploads carry the real time and still sort after the jump.
      h.clock.ms = start + 200 * DAY - 6 * HOUR;
      const corrected = await uploadOk(h.app, accountId, token, bytes(8, 2));
      expect(corrected.createdAt).toBe(new Date(h.clock.ms).toISOString());
      expect(corrected.version > (jumped[4]?.version ?? '')).toBe(true);
      const latest = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
      expect(latest.headers.get('X-Backup-Version')).toBe(corrected.version);
      expect(new Uint8Array(await latest.arrayBuffer())).toEqual(bytes(8, 2));
      // A new upload day pushes out the oldest one, as usual.
      expect(await listedVersions()).toEqual([
        corrected.version,
        ...jumpedIds,
        ...before.slice(0, -2),
      ]);
    },
    LONG_TEST_MS,
  );

  it(
    'caps an account that uploads every other day (400 days of history)',
    async () => {
      const { app, clock } = h;
      const [id, tok] = [accountId, token];
      const start = Date.parse('2025-01-01T20:00:00.000Z');
      const uploads: UploadResponse[] = [];
      for (let i = 0; i < 200; i += 1) {
        clock.ms = start + i * 2 * DAY;
        uploads.push(await uploadOk(app, id, tok, bytes(8)));
      }
      // The 180 most recent upload days, each with its snapshot, and nothing older.
      expect(await listedVersions()).toEqual(
        uploads
          .slice(-180)
          .map((u) => u.version)
          .reverse(),
      );
    },
    LONG_TEST_MS,
  );
});

describe('upload order', () => {
  it('never lets a slow upload of older data become latest', async () => {
    await uploadOk(h.app, accountId, token, bytes(8, 0));
    // S1 starts with older data, then the phone's connection crawls...
    const s1 = await startSlowUpload(accountId, token, 1);
    h.clock.advance(1000);
    // ...while S2, started later with newer data, finishes first.
    const s2 = await uploadOk(h.app, accountId, token, bytes(8, 2));
    s1.release();
    const s1Result = (await (await s1.response).json()) as UploadResponse;

    // Versions are numbered by when the upload started, not when it finished.
    expect(s1Result.version < s2.version).toBe(true);
    expect(Date.parse(s1Result.createdAt)).toBeLessThan(Date.parse(s2.createdAt));
    const latest = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
    expect(latest.headers.get('X-Backup-Version')).toBe(s2.version);
    expect(new Uint8Array(await latest.arrayBuffer())).toEqual(bytes(8, 2));
    expect((await listedVersions()).slice(0, 2)).toEqual([s2.version, s1Result.version]);
  });

  it('does not hold the account while a slow upload is still arriving', async () => {
    await uploadOk(h.app, accountId, token, bytes(8, 1));
    const slow = await startSlowUpload(accountId, token, 3);
    // Another upload, and a download, for the same account go straight through.
    await uploadOk(h.app, accountId, token, bytes(8, 2));
    expect(await statusOf(getWithToken(h.app, `/v1/backups/${accountId}/latest`, token))).toBe(200);
    slow.release();
    expect((await slow.response).status).toBe(201);
    expect(await listedVersions()).toHaveLength(3);
  });
});

describe('deleting while uploads are in flight', () => {
  it('drops an upload that was arriving when its account was deleted (409)', async () => {
    await uploadOk(h.app, accountId, token, bytes(8, 1));
    const slow = await startSlowUpload(accountId, token, 2);
    expect((await deleteAccount(accountId, token)).status).toBe(204); // not blocked by it

    slow.release();
    const late = await slow.response;
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: 'account_deleted' });
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
  });

  it('(a) a slow first upload cannot re-create an account deleted after a faster one', async () => {
    const slow = await startSlowUpload(accountId, token, 1);
    await uploadOk(h.app, accountId, token, bytes(8, 2)); // creates the account
    expect((await deleteAccount(accountId, token)).status).toBe(204);

    slow.release();
    expect((await slow.response).status).toBe(409);
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
  });

  it('(b) a DELETE during the very first upload stops it from creating the account', async () => {
    const slow = await startSlowUpload(accountId, token, 1);
    // Nothing exists yet, so the DELETE itself is a 401, like for any unknown account...
    expect((await deleteAccount(accountId, token)).status).toBe(401);

    slow.release();
    // ...but the upload that was in flight no longer lands.
    expect((await slow.response).status).toBe(409);
    expect(await listDir(path.join(h.dataDir, 'accounts'))).toEqual([]);
  });

  it('(c) an upload from before a DELETE never lands in the re-created account', async () => {
    await uploadOk(h.app, accountId, token, bytes(8, 1));
    const slow = await startSlowUpload(accountId, token, 2);
    expect((await deleteAccount(accountId, token)).status).toBe(204);
    const fresh = await uploadOk(h.app, accountId, token, bytes(8, 3)); // backup turned on again

    slow.release();
    expect((await slow.response).status).toBe(409);
    expect(await listedVersions()).toEqual([fresh.version]);
    const latest = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
    expect(new Uint8Array(await latest.arrayBuffer())).toEqual(bytes(8, 3));
  });

  it('does not let a wrong token cancel uploads in flight', async () => {
    await uploadOk(h.app, accountId, token, bytes(8, 1));
    const slow = await startSlowUpload(accountId, token, 2);
    expect((await deleteAccount(accountId, hex64())).status).toBe(401);
    slow.release();
    expect((await slow.response).status).toBe(201);
  });
});

describe('durability and crash leftovers', () => {
  it('leaves no temp files behind after uploads', async () => {
    for (let i = 0; i < 3; i += 1) await uploadOk(h.app, accountId, token, bytes(100, i));
    const accountFiles = await listDir(path.join(h.dataDir, 'accounts', accountId));
    expect(accountFiles).toEqual(['auth.json', 'versions']);
    expect((await listDir(versionsDir())).every((name) => name.endsWith('.bin'))).toBe(true);
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
  });

  it('ignores temp files left by a crash and cleans them up', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    await writeFile(path.join(h.dataDir, 'incoming', 'deadbeef.part'), 'half an upload');
    await writeFile(path.join(h.dataDir, 'accounts', accountId, '.tmp-0123456789abcdef'), '{');

    // Not visible as versions...
    expect(await listedVersions()).toHaveLength(1);
    // ...an auth temp file goes with the account's next upload...
    await uploadOk(h.app, accountId, token, bytes(10));
    expect(await listDir(path.join(h.dataDir, 'accounts', accountId))).toEqual([
      'auth.json',
      'versions',
    ]);
    // ...and partial uploads go on the next start.
    await prepareDataDir(h.dataDir);
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
    expect(await listedVersions()).toHaveLength(2);
  });

  it.each(['', 'null', '[]', '{not json', '{"tokenSha256":"abc"}'])(
    'refuses to treat a damaged auth record (%j) as a free account',
    async (damaged) => {
      await uploadOk(h.app, accountId, token, bytes(10, 1));
      const authPath = path.join(h.dataDir, 'accounts', accountId, 'auth.json');
      await writeFile(authPath, damaged);

      const takeover = await putBackup(h.app, accountId, hex64(), bytes(10, 2));
      expect(takeover.status).toBe(500);
      expect(await readFile(authPath, 'utf8')).toBe(damaged);
      expect(await listDir(versionsDir())).toHaveLength(1);
      expect(h.logs.join('\n')).toContain('auth record is corrupt');
    },
  );

  it('creates trash/ with the first account, so deleting works even once the disk is full', async () => {
    expect(await listDir(h.dataDir)).toEqual([]);
    await uploadOk(h.app, accountId, token, bytes(8));
    expect(await listDir(h.dataDir)).toContain('trash');
  });

  it('starts without needing space: clears trash/ and incoming/, keeps accounts', async () => {
    const dataDir = path.join(h.dataDir, 'existing');
    await mkdir(path.join(dataDir, 'trash', 'half-deleted-account', 'versions'), {
      recursive: true,
    });
    await writeFile(path.join(dataDir, 'trash', 'half-deleted-account', 'auth.json'), '{}');
    await mkdir(path.join(dataDir, 'incoming'));
    await writeFile(path.join(dataDir, 'incoming', 'abc.part'), 'partial');
    await mkdir(path.join(dataDir, 'accounts', accountId), { recursive: true });
    await writeFile(path.join(dataDir, 'accounts', accountId, 'auth.json'), '{}');

    await prepareDataDir(dataDir);
    expect(await listDir(dataDir)).toEqual(['accounts', 'incoming', 'trash']);
    expect(await listDir(path.join(dataDir, 'trash'))).toEqual([]);
    expect(await listDir(path.join(dataDir, 'incoming'))).toEqual([]);
    expect(await listDir(path.join(dataDir, 'accounts', accountId))).toEqual(['auth.json']);
  });

  it('creates a missing data directory (and its trash/) on first start', async () => {
    const dataDir = path.join(await makeTempDir(), 'new', 'data');
    await prepareDataDir(dataDir);
    expect(await listDir(dataDir)).toEqual(['trash']);
  });

  it('fails startup clearly when the data directory is unusable', async () => {
    const notADir = path.join(h.dataDir, 'file');
    await writeFile(notADir, 'x');
    await expect(prepareDataDir(notADir)).rejects.toThrow(/ENOTDIR|EEXIST/);
    await expect(prepareDataDir(path.join(os.devNull, 'data'))).rejects.toThrow();
  });
});

describe('concurrency', () => {
  it('serializes simultaneous uploads to one account into distinct, ordered versions', async () => {
    const first = await uploadOk(h.app, accountId, token, bytes(32, 99));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => uploadOk(h.app, accountId, token, bytes(32, i))),
    );
    const versions = results.map((r) => r.version);
    // Without the account lock, simultaneous uploads get the same sequence number and
    // overwrite each other's files.
    expect(new Set(versions).size).toBe(10);
    expect(versions.map((v) => Number(v.slice(0, 10))).sort((a, b) => a - b)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(await listedVersions()).toEqual([...versions].sort().reverse().concat(first.version));
  });

  it('creates an account once when its first uploads arrive together', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => uploadOk(h.app, accountId, token, bytes(8, i))),
    );
    expect(new Set(results.map((r) => r.version)).size).toBe(5);
    expect(await listDir(path.join(h.dataDir, 'new-accounts'))).toHaveLength(1);
    expect(await listedVersions()).toHaveLength(5);
  });

  it('lets exactly one of several racing first uploads claim a new account', async () => {
    const tokens = Array.from({ length: 5 }, () => hex64());
    const responses = await Promise.all(
      tokens.map((t) => putBackup(h.app, accountId, t, bytes(8))),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 401)).toHaveLength(4);
    const winner = tokens[statuses.indexOf(201)] ?? '';
    expect(await statusOf(getWithToken(h.app, `/v1/backups/${accountId}/latest`, winner))).toBe(
      200,
    );
    expect(await listDir(path.join(h.dataDir, 'incoming'))).toEqual([]);
  });

  it('keeps accounts independent', async () => {
    const other = { id: hex64(), token: hex64() };
    await uploadOk(h.app, accountId, token, bytes(8, 1));
    await uploadOk(h.app, other.id, other.token, bytes(8, 2));
    // Each token only opens its own account.
    expect((await getWithToken(h.app, `/v1/backups/${other.id}`, token)).status).toBe(401);
    const mine = await getWithToken(h.app, `/v1/backups/${accountId}/latest`, token);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(bytes(8, 1));
  });
});
