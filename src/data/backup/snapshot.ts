/**
 * The encrypted snapshot the cloud backup uploads: all data (`exportAll()`) as JSON,
 * gzipped when the browser can (CompressionStream, iOS 16.4+), then encrypted with
 * AES-GCM-256. Only this phone and whoever holds the backup code can read it; the
 * server stores the bytes as they are.
 *
 *   offset  bytes  content
 *   0       4      "HSB1" (ASCII): Hoop Stats Backup, format 1
 *   4       1      flags: bit 0 = the plaintext is gzipped; other bits are always 0
 *   5       12     AES-GCM IV, random for every snapshot
 *   17      n+16   ciphertext of the (gzipped) UTF-8 JSON, then the 16-byte GCM tag
 *
 * The GCM additional data is the 5 header bytes followed by the account id (ASCII
 * hex), so the flags can't be flipped, and a snapshot can't be passed off as another
 * account's, without decryption failing. A later format gets a new magic ("HSB2") or
 * a new flag, which this version reports as "update the app".
 */
import {
  EXPORT_SCHEMA_VERSION,
  ExportFileError,
  parseExportFile,
  type ExportFile,
} from '../transfer';
import type { BackupKeys } from './keys';

const MAGIC = 'HSB1';
const FLAG_GZIP = 0b0000_0001;
const KNOWN_FLAGS = FLAG_GZIP;
const HEADER_BYTES = MAGIC.length + 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** The smallest possible snapshot: header, IV and tag around an empty plaintext. */
const MIN_SNAPSHOT_BYTES = HEADER_BYTES + IV_BYTES + TAG_BYTES;

export type SnapshotKeys = Pick<BackupKeys, 'accountId' | 'encryptionKey'>;

export type SnapshotProblem = 'wrong-code' | 'damaged' | 'newer-version' | 'unsupported';

const MESSAGES: Record<SnapshotProblem, string> = {
  'wrong-code': "This backup code doesn't match this backup. Check the code and try again.",
  damaged: "This backup is damaged, so it can't be restored.",
  'newer-version':
    'This backup is from a newer version of Hoop Stats. Update the app, then try again.',
  unsupported: "This phone can't open this backup. Update to the latest iOS, then try again.",
};

/** A snapshot that can't be restored. `message` is written for the parent to read. */
export class SnapshotError extends Error {
  readonly problem: SnapshotProblem;
  /** Technical specifics for logs. */
  readonly details: string[];

  constructor(problem: SnapshotProblem, details: string[] = []) {
    super(MESSAGES[problem]);
    this.name = 'SnapshotError';
    this.problem = problem;
    this.details = details;
  }
}

const encoder = new TextEncoder();

/** Whether this browser can gzip (CompressionStream). */
export function canCompress(): boolean {
  return typeof globalThis.CompressionStream === 'function';
}

function canDecompress(): boolean {
  return typeof globalThis.DecompressionStream === 'function';
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

/** Runs bytes through a (de)compression stream. Rejects if the stream fails (bad gzip). */
async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const output = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  }).pipeThrough(stream);
  const chunks: Uint8Array[] = [];
  const reader = output.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatBytes(chunks);
}

function additionalData(header: Uint8Array, accountId: string): Uint8Array<ArrayBuffer> {
  return concatBytes([header, encoder.encode(accountId)]);
}

export interface EncryptSnapshotOptions {
  /** Gzip before encrypting. Defaults to whether the browser can (CompressionStream). */
  compress?: boolean;
}

/** Encrypts an export for upload (see the format above). */
export async function encryptSnapshot(
  file: ExportFile,
  keys: SnapshotKeys,
  options: EncryptSnapshotOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const compress = options.compress ?? canCompress();
  const json = encoder.encode(JSON.stringify(file));
  const plaintext = compress ? await transform(json, new CompressionStream('gzip')) : json;
  const header = concatBytes([encoder.encode(MAGIC), Uint8Array.of(compress ? FLAG_GZIP : 0)]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(header, keys.accountId) },
    keys.encryptionKey,
    plaintext,
  );
  return concatBytes([header, iv, new Uint8Array(ciphertext)]);
}

/** Checks the header; returns whether the plaintext is gzipped. */
function readHeader(snapshot: Uint8Array): boolean {
  if (snapshot.byteLength < MIN_SNAPSHOT_BYTES) {
    throw new SnapshotError('damaged', [`Only ${snapshot.byteLength} bytes`]);
  }
  const magic = String.fromCharCode(...snapshot.subarray(0, MAGIC.length));
  if (magic !== MAGIC) {
    // "HSB2" and up: a later format this version can't read yet.
    const later = magic.startsWith('HSB') && magic.charAt(3) > MAGIC.charAt(3);
    throw new SnapshotError(later ? 'newer-version' : 'damaged', [
      `Magic ${JSON.stringify(magic)}`,
    ]);
  }
  const flags = snapshot[MAGIC.length] ?? 0;
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new SnapshotError('newer-version', [`Flags ${flags.toString(2)}`]);
  }
  return (flags & FLAG_GZIP) !== 0;
}

/**
 * Decrypts a snapshot and checks it's a backup this version can restore. Throws
 * SnapshotError (with a message for the parent) if it can't: the wrong code,
 * damaged bytes, or a newer format.
 */
export async function decryptSnapshot(
  snapshot: Uint8Array<ArrayBuffer>,
  keys: SnapshotKeys,
): Promise<ExportFile> {
  const gzipped = readHeader(snapshot);
  const header = snapshot.slice(0, HEADER_BYTES);
  const iv = snapshot.slice(HEADER_BYTES, HEADER_BYTES + IV_BYTES);
  const ciphertext = snapshot.slice(HEADER_BYTES + IV_BYTES);

  let plaintext: Uint8Array<ArrayBuffer>;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: additionalData(header, keys.accountId) },
        keys.encryptionKey,
        ciphertext,
      ),
    );
  } catch {
    // GCM authenticates everything: a different key, account or tampered byte all fail here.
    throw new SnapshotError('wrong-code', ['AES-GCM authentication failed']);
  }

  if (gzipped) {
    if (!canDecompress()) throw new SnapshotError('unsupported', ['No DecompressionStream']);
    try {
      plaintext = await transform(plaintext, new DecompressionStream('gzip'));
    } catch {
      throw new SnapshotError('damaged', ['Not valid gzip']);
    }
  }

  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new SnapshotError('damaged', ['Not UTF-8 JSON']);
  }
  // Checked before the contents, like parseExportFile does: a newer export may hold
  // things this version doesn't know, and must get "update the app", not "damaged".
  const version = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === 'number' && version > EXPORT_SCHEMA_VERSION) {
    throw new SnapshotError('newer-version', [`schemaVersion: ${version}`]);
  }
  try {
    return parseExportFile(data);
  } catch (error) {
    if (!(error instanceof ExportFileError)) throw error;
    throw new SnapshotError('damaged', [error.message, ...error.details]);
  }
}
