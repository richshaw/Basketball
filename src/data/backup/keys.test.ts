import { describe, expect, it } from 'vitest';
import { generateBackupSecret } from './code';
import { BACKUP_KDF_LABELS, deriveBackupKeys, isWebCryptoAvailable, toHex } from './keys';

/** Known answers for secret 00 01 … 0f, computed with Node's crypto.hkdfSync and AES-GCM. */
const SECRET = Uint8Array.from({ length: 16 }, (_, index) => index);
const ACCOUNT_ID = '9474c29237996a6c14befffc9855a31e8afef9c30b6d0f19ff072e9162cc743a';
const AUTH_TOKEN = '401c4eaa6df1e1f0f360b47d2c26005c0feb4e345e6a31da842d5221f83b6e0e';
/** AES-GCM with the derived key, IV 07 × 12, plaintext "Hoop Stats": ciphertext then tag. */
const GCM_ANSWER = 'f77a1783d26a0e272a8857be67bd6cc436cad9f74a2d4832f1f6';

describe('backup keys', () => {
  it('uses fixed HKDF labels (changing them would orphan every backup)', () => {
    expect(BACKUP_KDF_LABELS).toEqual({
      salt: 'hoopstats/v1/salt',
      accountId: 'hoopstats/v1/account-id',
      authToken: 'hoopstats/v1/auth-token',
      encryptionKey: 'hoopstats/v1/enc-key',
    });
    expect(isWebCryptoAvailable()).toBe(true);
  });

  it('derives the known account id, token and encryption key', async () => {
    const keys = await deriveBackupKeys(SECRET);
    expect(keys.accountId).toBe(ACCOUNT_ID);
    expect(keys.authToken).toBe(AUTH_TOKEN);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(12).fill(7) },
      keys.encryptionKey,
      new TextEncoder().encode('Hoop Stats'),
    );
    expect(toHex(ciphertext)).toBe(GCM_ANSWER);
  });

  it('keeps the encryption key inside WebCrypto', async () => {
    const { encryptionKey } = await deriveBackupKeys(SECRET);
    expect(encryptionKey.extractable).toBe(false);
    expect(encryptionKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    expect([...encryptionKey.usages].sort()).toEqual(['decrypt', 'encrypt']);
    await expect(crypto.subtle.exportKey('raw', encryptionKey)).rejects.toThrow();
  });

  it('is deterministic, and different for every code', async () => {
    const secret = generateBackupSecret();
    const [a, b, other] = await Promise.all([
      deriveBackupKeys(secret),
      deriveBackupKeys(new Uint8Array(secret)),
      deriveBackupKeys(generateBackupSecret()),
    ]);
    expect(a.accountId).toBe(b.accountId);
    expect(a.authToken).toBe(b.authToken);
    expect(other.accountId).not.toBe(a.accountId);
    for (const value of [a.accountId, a.authToken, other.authToken]) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(a.accountId).not.toBe(a.authToken);
  });

  it('writes bytes as lowercase hex', () => {
    expect(toHex(Uint8Array.of(0, 15, 16, 255))).toBe('000f10ff');
    expect(toHex(Uint8Array.of(1, 2, 3).subarray(1))).toBe('0203');
    expect(toHex(new ArrayBuffer(2))).toBe('0000');
  });
});
