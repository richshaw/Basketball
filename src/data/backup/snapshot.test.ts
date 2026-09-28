import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemoData } from '../demo';
import type { ExportFile } from '../transfer';
import { generateBackupSecret } from './code';
import { deriveBackupKeys, type BackupKeys } from './keys';
import { decryptSnapshot, encryptSnapshot, SnapshotError, type SnapshotProblem } from './snapshot';

/** A snapshot made by Node's zlib + AES-256-GCM (independent of this code), for secret 00…0f. */
const NODE_SNAPSHOT_BASE64 =
  'SFNCMQEAAQIDBAUGBwgJCguMNwEyY93wQSTPx2V/Pa7E0lI/BqcR1dn52Rmfw2+dgo89c9vS8J2zk9LETi3VGRv7UpBrTA59uHAnxu3IKGv8bFHhr6AC7N6q0yfORRwZ375RcHzkyvYlYfapV5fMH2eYLR2uVPNb5rKQ/y/2O69Q6qgHf52544mU6qRpKEitKS764m93Rc89eAl35Zqbs2GTOE+IHeb8MjQnoELyeikqEwWnphLq2KRIVYHQzHCC/P/XMkX/KKRtW0IOP6rF63xToBOPzbp7nEBe4gIcdKVKuWTW5xazm3XjbaC8/tndrpQHIjg/E+eMq2XjckliqIZheBGdJn2io5vLWjaFKBj4AsbtC659FsxPeftwUAtz6zzykOSkaskCivQ0iPowqq06tZSobwDFMyuHxdVCj0+fj7bw5FSD3I/VM4tf2gjihIq4Obv8+CilZhJBCclF3Q0a1LRjKXOzPQYcKnrRM+rQ';
const NODE_SNAPSHOT_FILE: ExportFile = {
  app: 'hoop-stats',
  schemaVersion: 1,
  exportedAt: '2026-09-27T20:15:00.000Z',
  players: [
    {
      id: 'p1',
      name: 'Ava',
      jerseyNumber: '12',
      createdAt: 1790000000000,
      updatedAt: 1790000000000,
    },
  ],
  games: [
    {
      id: 'g1',
      playerId: 'p1',
      opponent: 'Lincoln',
      date: '2026-09-27',
      periodFormat: 'quarters',
      currentPeriod: 4,
      status: 'final',
      teamScore: 51,
      opponentScore: 48,
      createdAt: 1790000100000,
      updatedAt: 1790000200000,
      endedAt: 1790000200000,
    },
  ],
  events: [
    {
      id: 'e1',
      gameId: 'g1',
      type: 'fg3_made',
      period: 1,
      createdAt: 1790000150000,
      location: { x: 22, y: 1.5 },
    },
  ],
  settings: { shotChart: true, defaultPeriodFormat: 'quarters' },
};

const fromBase64 = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);
const encoder = new TextEncoder();

async function problemOf(promise: Promise<unknown>): Promise<SnapshotProblem> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SnapshotError) return error.problem;
    throw error;
  }
  throw new Error('Expected a SnapshotError');
}

/** A snapshot of arbitrary plaintext, in the HSB1 layout, for data encryptSnapshot never makes. */
async function rawSnapshot(keys: BackupKeys, plaintext: Uint8Array<ArrayBuffer>, flags: number) {
  const header = Uint8Array.of(...encoder.encode('HSB1'), flags);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = Uint8Array.of(...header, ...encoder.encode(keys.accountId));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData },
      keys.encryptionKey,
      plaintext,
    ),
  );
  return Uint8Array.of(...header, ...iv, ...ciphertext);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encrypted snapshots', () => {
  it('round-trips an export, gzipped', async () => {
    const keys = await deriveBackupKeys(generateBackupSecret());
    const file = buildDemoData({ today: '2026-09-27', liveGame: true });
    const snapshot = await encryptSnapshot(file, keys);

    expect(text(snapshot.subarray(0, 4))).toBe('HSB1');
    expect(snapshot[4]).toBe(1);
    // Gzip shrinks the ~100 KB of JSON a lot.
    expect(snapshot.byteLength).toBeLessThan(JSON.stringify(file).length / 3);
    expect(await decryptSnapshot(snapshot, keys)).toEqual(file);
  });

  it('never contains the data in the clear, and uses a new IV each time', async () => {
    const keys = await deriveBackupKeys(generateBackupSecret());
    const file = buildDemoData({ today: '2026-09-27' });
    const [a, b] = await Promise.all([
      encryptSnapshot(file, keys, { compress: false }),
      encryptSnapshot(file, keys, { compress: false }),
    ]);
    for (const snapshot of [a, b]) {
      const body = text(snapshot);
      for (const plain of ['hoop-stats', 'Ava', 'Lincoln', 'fg2_made']) {
        expect(body).not.toContain(plain);
      }
    }
    expect(text(a.subarray(5, 17))).not.toBe(text(b.subarray(5, 17)));
  });

  it('falls back to no compression without CompressionStream', async () => {
    const keys = await deriveBackupKeys(generateBackupSecret());
    const file = buildDemoData({ today: '2026-09-27' });
    vi.stubGlobal('CompressionStream', undefined);
    const snapshot = await encryptSnapshot(file, keys);
    expect(snapshot[4]).toBe(0);
    // 17 header bytes + the JSON + the 16-byte tag.
    expect(snapshot.byteLength).toBe(17 + encoder.encode(JSON.stringify(file)).length + 16);
    expect(await decryptSnapshot(snapshot, keys)).toEqual(file);
  });

  it('reads a snapshot made by another implementation of the format', async () => {
    const keys = await deriveBackupKeys(Uint8Array.from({ length: 16 }, (_, index) => index));
    expect(await decryptSnapshot(fromBase64(NODE_SNAPSHOT_BASE64), keys)).toEqual(
      NODE_SNAPSHOT_FILE,
    );
  });

  it("says the code doesn't match for another code, account or any tampering", async () => {
    const keys = await deriveBackupKeys(generateBackupSecret());
    const other = await deriveBackupKeys(generateBackupSecret());
    const snapshot = await encryptSnapshot(buildDemoData({ today: '2026-09-27' }), keys);

    await expect(decryptSnapshot(snapshot, other)).rejects.toThrow(
      "This backup code doesn't match this backup. Check the code and try again.",
    );
    // The account id is bound in: the right key under another account fails.
    expect(
      await problemOf(decryptSnapshot(snapshot, { ...keys, accountId: other.accountId })),
    ).toBe('wrong-code');
    for (const index of [4, 5, 30, snapshot.byteLength - 1]) {
      const tampered = new Uint8Array(snapshot);
      tampered[index] = (tampered[index] ?? 0) ^ 1;
      expect(await problemOf(decryptSnapshot(tampered, keys))).toBe('wrong-code');
    }
    expect(await problemOf(decryptSnapshot(snapshot.slice(0, -1), keys))).toBe('wrong-code');
  });

  it('tells damaged data from a newer format', async () => {
    const keys = await deriveBackupKeys(generateBackupSecret());
    const snapshot = await encryptSnapshot(buildDemoData({ today: '2026-09-27' }), keys);
    const withHeader = (magic: string, flags = 1) =>
      Uint8Array.of(...encoder.encode(magic), flags, ...snapshot.subarray(5));

    expect(await problemOf(decryptSnapshot(snapshot.slice(0, 20), keys))).toBe('damaged');
    expect(await problemOf(decryptSnapshot(withHeader('XXXX'), keys))).toBe('damaged');
    await expect(decryptSnapshot(withHeader('HSB2'), keys)).rejects.toThrow(
      'This backup is from a newer version of Hoop Stats. Update the app, then try again.',
    );
    expect(await problemOf(decryptSnapshot(withHeader('HSB1', 0b11), keys))).toBe('newer-version');
  });

  it('checks the decrypted data is a backup this version can restore', async () => {
    const keys = await deriveBackupKeys(generateBackupSecret());
    const json = (value: unknown) => encoder.encode(JSON.stringify(value));
    const newer = { ...NODE_SNAPSHOT_FILE, schemaVersion: 2 };

    expect(await problemOf(decryptSnapshot(await rawSnapshot(keys, json(newer), 0), keys))).toBe(
      'newer-version',
    );
    const notExport = await rawSnapshot(keys, json({ app: 'other' }), 0);
    await expect(decryptSnapshot(notExport, keys)).rejects.toThrow(
      "This backup is damaged, so it can't be restored.",
    );
    const notJson = await rawSnapshot(keys, Uint8Array.of(0xff, 0xfe), 0);
    expect(await problemOf(decryptSnapshot(notJson, keys))).toBe('damaged');
    const notGzip = await rawSnapshot(keys, json(NODE_SNAPSHOT_FILE), 1);
    expect(await problemOf(decryptSnapshot(notGzip, keys))).toBe('damaged');
  });

  it("says a phone without DecompressionStream can't open a gzipped backup", async () => {
    const keys = await deriveBackupKeys(generateBackupSecret());
    const snapshot = await encryptSnapshot(NODE_SNAPSHOT_FILE, keys);
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(decryptSnapshot(snapshot, keys)).rejects.toThrow(
      "This phone can't open this backup. Update to the latest iOS, then try again.",
    );
  });
});
