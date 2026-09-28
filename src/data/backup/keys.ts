/**
 * What a backup code's secret turns into (WebCrypto HKDF-SHA256, one label each):
 * - `accountId`: names this family's backups on the server (64 lowercase hex);
 * - `authToken`: proves to the server that this phone may read and write them (64 hex);
 * - `encryptionKey`: the AES-GCM-256 key for the snapshots. It never leaves the phone
 *   and can't be exported, so the server only ever sees ciphertext.
 * The same code always gives the same three, on any device. The labels below are part
 * of the backup format: changing any of them makes every existing backup unreadable.
 */

/** HKDF salt and info labels (UTF-8). Fixed forever for version 1 backups. */
export const BACKUP_KDF_LABELS = {
  salt: 'hoopstats/v1/salt',
  accountId: 'hoopstats/v1/account-id',
  authToken: 'hoopstats/v1/auth-token',
  encryptionKey: 'hoopstats/v1/enc-key',
} as const;

export interface BackupKeys {
  /** Names the backups on the server: 64 lowercase hex characters. */
  accountId: string;
  /** Sent as `Authorization: Bearer …`: 64 lowercase hex characters. */
  authToken: string;
  /** AES-GCM-256, not extractable. */
  encryptionKey: CryptoKey;
}

const encoder = new TextEncoder();

/**
 * Whether this browser can do the backup's cryptography. `crypto.subtle` only exists
 * in secure contexts (https, or localhost), so a phone testing over plain http on the
 * LAN has no cloud backup.
 */
export function isWebCryptoAvailable(): boolean {
  const webCrypto = globalThis.crypto as Crypto | undefined;
  return typeof webCrypto?.subtle?.importKey === 'function';
}

/** Lowercase hex, two characters per byte. */
export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  let hex = '';
  for (const byte of view) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function hkdfParams(info: string): HkdfParams {
  return {
    name: 'HKDF',
    hash: 'SHA-256',
    salt: encoder.encode(BACKUP_KDF_LABELS.salt),
    info: encoder.encode(info),
  };
}

/** Derives the account id, auth token and encryption key from a code's secret bytes. */
export async function deriveBackupKeys(secret: Uint8Array<ArrayBuffer>): Promise<BackupKeys> {
  const master = await crypto.subtle.importKey('raw', secret, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const [accountId, authToken, encryptionKey] = await Promise.all([
    crypto.subtle.deriveBits(hkdfParams(BACKUP_KDF_LABELS.accountId), master, 256).then(toHex),
    crypto.subtle.deriveBits(hkdfParams(BACKUP_KDF_LABELS.authToken), master, 256).then(toHex),
    crypto.subtle.deriveKey(
      hkdfParams(BACKUP_KDF_LABELS.encryptionKey),
      master,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    ),
  ]);
  return { accountId, authToken, encryptionKey };
}
