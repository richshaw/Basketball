import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareDataDir } from '../src/store.js';
import type { Harness, UploadResponse } from './helpers.js';
import {
  bytes,
  createHarness,
  getWithToken,
  hex64,
  listDir,
  putBackup,
  uploadOk,
} from './helpers.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

const versionsDir = (): string => path.join(h.dataDir, 'accounts', accountId, 'versions');

async function listedVersions(): Promise<string[]> {
  const res = await getWithToken(h.app, `/v1/backups/${accountId}`, token);
  const body = (await res.json()) as { versions: { version: string }[] };
  return body.versions.map((v) => v.version);
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

  it('keeps one snapshot per day for 180 days plus the 20 most recent', async () => {
    const start = Date.parse('2026-01-01T00:00:00.000Z');
    const byDay = new Map<number, UploadResponse[]>();
    const record = (day: number, upload: UploadResponse): void => {
      byDay.set(day, [...(byDay.get(day) ?? []), upload]);
    };

    // 200 days of use: two uploads most evenings, and a burst of 25 on the final day.
    for (let day = 0; day < 200; day += 1) {
      for (const hour of day % 3 === 0 ? [20] : [19, 21]) {
        h.clock.ms = start + day * DAY + hour * HOUR;
        record(day, await uploadOk(h.app, accountId, token, bytes(8, day % 256)));
      }
    }
    const finalDay = 200;
    for (let i = 0; i < 25; i += 1) {
      h.clock.ms = start + finalDay * DAY + 18 * HOUR + i * MINUTE;
      record(finalDay, await uploadOk(h.app, accountId, token, bytes(8)));
    }

    // Expected, computed straight from the rules: the 20 newest uploads, plus the newest upload
    // of each UTC day from finalDay - 179 to finalDay.
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
  });
});

describe('durability and crash leftovers', () => {
  it('leaves no temp files behind after uploads', async () => {
    for (let i = 0; i < 3; i += 1) await uploadOk(h.app, accountId, token, bytes(100, i));
    const accountFiles = await listDir(path.join(h.dataDir, 'accounts', accountId));
    expect(accountFiles).toEqual(['auth.json', 'versions']);
    expect((await listDir(versionsDir())).every((name) => name.endsWith('.bin'))).toBe(true);
  });

  it('ignores and then cleans up temp files left by a crash', async () => {
    await uploadOk(h.app, accountId, token, bytes(10));
    await writeFile(path.join(versionsDir(), '.tmp-deadbeefdeadbeef'), 'half an upload');
    await writeFile(path.join(h.dataDir, 'accounts', accountId, '.tmp-0123456789abcdef'), '{');

    // Not visible as a version...
    expect(await listedVersions()).toHaveLength(1);
    // ...and removed by the next upload.
    await uploadOk(h.app, accountId, token, bytes(10));
    expect((await listDir(versionsDir())).some((n) => n.startsWith('.tmp-'))).toBe(false);
    expect(await listDir(path.join(h.dataDir, 'accounts', accountId))).toEqual([
      'auth.json',
      'versions',
    ]);
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

  it('finishes interrupted deletions and checks writability on startup', async () => {
    const dataDir = path.join(h.dataDir, 'fresh');
    await mkdir(path.join(dataDir, 'trash', 'half-deleted-account', 'versions'), {
      recursive: true,
    });
    await writeFile(path.join(dataDir, 'trash', 'half-deleted-account', 'auth.json'), '{}');

    await prepareDataDir(dataDir);
    expect(await listDir(dataDir)).toEqual(['accounts', 'trash']);
    expect(await listDir(path.join(dataDir, 'trash'))).toEqual([]);
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
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => uploadOk(h.app, accountId, token, bytes(32, i))),
    );
    const versions = results.map((r) => r.version);
    expect(new Set(versions).size).toBe(10);
    expect(await listedVersions()).toEqual([...versions].sort().reverse());
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
    expect((await getWithToken(h.app, `/v1/backups/${accountId}/latest`, winner)).status).toBe(200);
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
