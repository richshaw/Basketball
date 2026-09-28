import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
  access,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStreamReadResult } from 'node:stream/web';
import { isHex64 } from './auth.js';
import { KeyedMutex } from './keyedMutex.js';
import { compareNewestFirst, isVersionId, parseVersionId } from './versionId.js';

/**
 * Filesystem layout under DATA_DIR:
 *
 *   accounts/<accountId>/auth.json               {"tokenSha256": "...", "createdAt": "..."}
 *   accounts/<accountId>/versions/<version>.bin  opaque encrypted bytes, exactly as uploaded
 *   incoming/                                    uploads still arriving (cleared on startup)
 *   trash/                                       deleted accounts on their way out
 *   new-accounts/                                one empty file per account created recently
 *
 * Files are written to a temp file on the same filesystem, fsynced, then renamed into place, so
 * a crash never leaves a half-written auth record or backup visible.
 */

export interface AuthRecord {
  tokenSha256: string;
  createdAt: string;
}

export interface VersionRef {
  version: string;
  createdAtMs: number;
}

export interface StoredVersion extends VersionRef {
  size: number;
}

export interface OpenedVersion {
  stream: ReadableStream<Uint8Array>;
  size: number;
}

export type UploadResult =
  { kind: 'received'; tempPath: string; size: number } | { kind: 'too_large' } | { kind: 'empty' };

export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
}

/** The request body stream failed, usually because the client went away mid-upload. */
export class BodyReadError extends Error {
  override name = 'BodyReadError';
}

/** The client stopped sending the body (no bytes for the stall timeout). */
export class UploadStalledError extends BodyReadError {
  override name = 'UploadStalledError';
}

const ACCOUNTS_DIR = 'accounts';
const INCOMING_DIR = 'incoming';
const TRASH_DIR = 'trash';
const NEW_ACCOUNTS_DIR = 'new-accounts';
const TEMP_PREFIX = '.tmp-';
const VERSION_SUFFIX = '.bin';
// Lock key for account creation; can never collide with a (hex) account id.
const CREATION_LOCK = '#account-creation';

function randomName(bytes = 8): string {
  return randomBytes(bytes).toString('hex');
}

export function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
}

async function readdirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return [];
    throw err;
  }
}

/** Free space available to this process and total size of the filesystem holding `dir`. */
export async function readDiskSpace(dir: string): Promise<DiskSpace> {
  const s = await statfs(dir);
  return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
}

/** Makes renames/unlinks in `dir` durable. Best effort: not every platform supports it. */
async function fsyncDir(dir: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // e.g. EISDIR/EPERM on Windows; the rename itself has already happened.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    offset += bytesWritten;
  }
}

/** Temp file in the same directory, fsync, rename over the target, fsync the directory. */
async function atomicWriteFile(target: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(target);
  const temp = path.join(dir, `${TEMP_PREFIX}${randomName()}`);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
  await fsyncDir(dir);
}

async function emptyDirectory(dir: string): Promise<void> {
  for (const name of await readdirOrEmpty(dir)) {
    await rm(path.join(dir, name), { recursive: true, force: true });
  }
}

/**
 * Reads the next chunk, or fails with UploadStalledError if none arrives within `stallMs`
 * (the caller cancels the reader), or with BodyReadError if the stream breaks.
 */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stallMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new UploadStalledError(`no upload data for ${stallMs} ms`));
    }, stallMs);
  });
  try {
    return await Promise.race([
      reader.read().catch((err: unknown) => {
        throw new BodyReadError('request body could not be read', { cause: err });
      }),
      stalled,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class BackupStore {
  readonly #accountsDir: string;
  readonly #incomingDir: string;
  readonly #trashDir: string;
  readonly #newAccountsDir: string;
  readonly #locks = new KeyedMutex();

  constructor(dataDir: string) {
    this.#accountsDir = path.join(dataDir, ACCOUNTS_DIR);
    this.#incomingDir = path.join(dataDir, INCOMING_DIR);
    this.#trashDir = path.join(dataDir, TRASH_DIR);
    this.#newAccountsDir = path.join(dataDir, NEW_ACCOUNTS_DIR);
  }

  // Paths are only ever built from strictly validated ids (defense in depth: the HTTP layer
  // validates first, and these throw rather than touch an unexpected path).
  #accountDir(accountId: string): string {
    if (!isHex64(accountId)) throw new Error('refusing to build a path from an invalid account id');
    return path.join(this.#accountsDir, accountId);
  }

  #versionsDir(accountId: string): string {
    return path.join(this.#accountDir(accountId), 'versions');
  }

  #versionPath(accountId: string, version: string): string {
    if (!isVersionId(version)) throw new Error('refusing to build a path from an invalid version');
    return path.join(this.#versionsDir(accountId), `${version}${VERSION_SUFFIX}`);
  }

  /** Runs `task` while holding the account's lock (committing uploads and deleting). */
  withAccountLock<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    return this.#locks.run(accountId, task);
  }

  /** Runs `task` while holding the global lock that serializes account creation. */
  withCreationLock<T>(task: () => Promise<T>): Promise<T> {
    return this.#locks.run(CREATION_LOCK, task);
  }

  async readAuth(accountId: string): Promise<AuthRecord | null> {
    let text: string;
    try {
      text = await readFile(path.join(this.#accountDir(accountId), 'auth.json'), 'utf8');
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return null;
      throw err;
    }
    // A damaged auth file must fail loudly. Treating it as "no account" would let the next
    // uploader claim the account (trust on first use).
    let record: unknown;
    try {
      record = JSON.parse(text);
    } catch {
      record = null;
    }
    const { tokenSha256, createdAt } = (record ?? {}) as Partial<Record<keyof AuthRecord, unknown>>;
    if (typeof tokenSha256 !== 'string' || !isHex64(tokenSha256)) {
      throw new Error('auth record is corrupt');
    }
    return { tokenSha256, createdAt: typeof createdAt === 'string' ? createdAt : '' };
  }

  /** Number of accounts (directories holding an auth record). */
  async countAccounts(): Promise<number> {
    let count = 0;
    for (const name of await readdirOrEmpty(this.#accountsDir)) {
      if (!isHex64(name)) continue;
      try {
        await access(path.join(this.#accountsDir, name, 'auth.json'));
        count += 1;
      } catch (err) {
        if (!isErrno(err, 'ENOENT')) throw err;
      }
    }
    return count;
  }

  /**
   * Times (epoch ms, oldest first) of the accounts created within `windowMs` before `nowMs`.
   * Kept on disk so the daily cap survives restarts (the machine stops when idle). Expired
   * records, and records dated more than a window ahead (a clock that had jumped forward),
   * are deleted along the way.
   */
  async recentAccountCreations(nowMs: number, windowMs: number): Promise<number[]> {
    const times: number[] = [];
    for (const name of await readdirOrEmpty(this.#newAccountsDir)) {
      const time = Number(/^(\d+)-[0-9a-f]+$/.exec(name)?.[1]);
      if (Number.isSafeInteger(time) && time > nowMs - windowMs && time <= nowMs + windowMs) {
        times.push(time);
      } else {
        await rm(path.join(this.#newAccountsDir, name), { force: true });
      }
    }
    return times.sort((a, b) => a - b);
  }

  /** Creates the account directory and auth record, and notes the creation time. */
  async createAccount(accountId: string, record: AuthRecord, nowMs: number): Promise<void> {
    await mkdir(this.#versionsDir(accountId), { recursive: true, mode: 0o700 });
    // DELETE renames accounts into trash/; make sure it exists while there is room, so deleting
    // still works once the disk is full (creating a directory can need a free block).
    await mkdir(this.#trashDir, { recursive: true, mode: 0o700 });
    await atomicWriteFile(
      path.join(this.#accountDir(accountId), 'auth.json'),
      `${JSON.stringify(record)}\n`,
    );
    await mkdir(this.#newAccountsDir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(this.#newAccountsDir, `${nowMs}-${randomName(4)}`), '', {
      flag: 'wx',
      mode: 0o600,
    });
  }

  /** Version ids and timestamps, newest first, without touching file contents. */
  async listVersionRefs(accountId: string): Promise<VersionRef[]> {
    const refs: VersionRef[] = [];
    for (const name of await readdirOrEmpty(this.#versionsDir(accountId))) {
      if (!name.endsWith(VERSION_SUFFIX)) continue;
      const version = name.slice(0, -VERSION_SUFFIX.length);
      const parsed = parseVersionId(version);
      if (parsed !== null) refs.push({ version, createdAtMs: parsed.createdAtMs });
    }
    return refs.sort(compareNewestFirst);
  }

  /** Sequence number of the newest stored version, or 0 if there is none. */
  async highestSequence(accountId: string): Promise<number> {
    const [newest] = await this.listVersionRefs(accountId);
    return newest === undefined ? 0 : (parseVersionId(newest.version)?.sequence ?? 0);
  }

  /** Versions with their sizes, newest first. */
  async listVersions(accountId: string): Promise<StoredVersion[]> {
    const refs = await this.listVersionRefs(accountId);
    const versions = await Promise.all(
      refs.map(async (ref): Promise<StoredVersion | null> => {
        const size = await this.versionSize(accountId, ref.version);
        return size === null ? null : { ...ref, size }; // null: pruned while we were listing
      }),
    );
    return versions.filter((v): v is StoredVersion => v !== null);
  }

  async versionSize(accountId: string, version: string): Promise<number | null> {
    try {
      return (await stat(this.#versionPath(accountId, version))).size;
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return null;
      throw err;
    }
  }

  /**
   * Opens a version for streaming. The file handle pins the data, so the full size is served
   * even if the version is pruned meanwhile. It is closed when the stream ends, is cancelled,
   * or `signal` aborts: a client that disconnects before the response starts never reads or
   * cancels the stream, and the file would otherwise stay open until garbage collection.
   */
  async openVersion(
    accountId: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<OpenedVersion | null> {
    let handle: FileHandle;
    try {
      handle = await open(this.#versionPath(accountId, version), 'r');
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return null;
      throw err;
    }
    try {
      const { size } = await handle.stat();
      const file = handle.createReadStream(); // closes the handle when done or destroyed
      if (signal !== undefined) {
        const abort = (): void => void file.destroy();
        if (signal.aborted) {
          abort();
        } else {
          signal.addEventListener('abort', abort, { once: true });
          file.once('close', () => signal.removeEventListener('abort', abort));
        }
      }
      return { stream: Readable.toWeb(file) as ReadableStream<Uint8Array>, size };
    } catch (err) {
      await handle.close();
      throw err;
    }
  }

  /**
   * Streams a request body into incoming/, stopping as soon as it exceeds `maxBytes` (so an
   * oversized upload is never buffered or stored in full), and giving up with
   * UploadStalledError if no bytes arrive for `stallMs`. Takes no lock. On success the caller
   * must `commitUpload` or `discardUpload` the temp file.
   */
  async receiveUpload(
    body: ReadableStream<Uint8Array> | null,
    maxBytes: number,
    stallMs: number,
  ): Promise<UploadResult> {
    await mkdir(this.#incomingDir, { recursive: true, mode: 0o700 });
    const tempPath = path.join(this.#incomingDir, `${randomName(12)}.part`);
    let size = 0;
    let tooLarge = false;
    try {
      const handle = await open(tempPath, 'wx', 0o600);
      try {
        if (body !== null) {
          const reader = body.getReader();
          try {
            for (;;) {
              let chunk: ReadableStreamReadResult<Uint8Array>;
              try {
                chunk = await readChunk(reader, stallMs);
              } catch (err) {
                await reader.cancel().catch(() => undefined); // e.g. the stalled read
                throw err;
              }
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > maxBytes) {
                tooLarge = true;
                // Stop reading. The HTTP layer discards whatever the client is still sending.
                await reader.cancel().catch(() => undefined);
                break;
              }
              await writeAll(handle, chunk.value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        if (!tooLarge && size > 0) await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (err) {
      await rm(tempPath, { force: true });
      throw err;
    }
    if (tooLarge || size === 0) {
      await rm(tempPath, { force: true });
      return { kind: tooLarge ? 'too_large' : 'empty' };
    }
    return { kind: 'received', tempPath, size };
  }

  /** Moves a received upload into place as `version` (same filesystem, so atomic). */
  async commitUpload(accountId: string, tempPath: string, version: string): Promise<void> {
    await mkdir(this.#versionsDir(accountId), { recursive: true, mode: 0o700 });
    await rename(tempPath, this.#versionPath(accountId, version));
    await fsyncDir(this.#versionsDir(accountId));
  }

  async discardUpload(tempPath: string): Promise<void> {
    await rm(tempPath, { force: true });
  }

  async deleteVersions(accountId: string, versions: readonly string[]): Promise<void> {
    if (versions.length === 0) return;
    for (const version of versions) {
      await rm(this.#versionPath(accountId, version), { force: true });
    }
    await fsyncDir(this.#versionsDir(accountId));
  }

  /**
   * Removes temp files a crash left next to an auth record. Only call while holding the
   * account lock: then no write for this account is in flight, so every temp file is stale.
   */
  async removeStaleTempFiles(accountId: string): Promise<void> {
    const dir = this.#accountDir(accountId);
    for (const name of await readdirOrEmpty(dir)) {
      if (name.startsWith(TEMP_PREFIX)) await rm(path.join(dir, name), { force: true });
    }
  }

  /**
   * Deletes an account and all its versions. The account directory is first renamed into
   * trash/ (atomic), so the account vanishes in one step even if the process dies while the
   * files are being removed; leftovers in trash/ are cleared on the next start.
   */
  async deleteAccount(accountId: string): Promise<boolean> {
    await mkdir(this.#trashDir, { recursive: true, mode: 0o700 });
    const trashed = path.join(this.#trashDir, randomName(12));
    try {
      await rename(this.#accountDir(accountId), trashed);
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return false;
      throw err;
    }
    await fsyncDir(this.#accountsDir);
    await rm(trashed, { recursive: true, force: true });
    return true;
  }
}

/**
 * Startup check. Needs no free space, so the server still starts (and restores keep working)
 * when the disk is completely full: it makes sure the data directory exists and is accessible
 * (failing fast on e.g. a volume mounted with the wrong ownership), then finishes deletions
 * interrupted by a restart and drops half-received uploads, both of which only free space.
 * The one thing it may create is trash/ (so DELETE works on a full disk), and only if there is
 * room; other subdirectories are created on demand.
 */
export async function prepareDataDir(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await access(dataDir, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  const trash = path.join(dataDir, TRASH_DIR);
  await emptyDirectory(trash);
  await mkdir(trash, { recursive: true, mode: 0o700 }).catch((err: unknown) => {
    if (!isErrno(err, 'ENOSPC')) throw err;
  });
  await emptyDirectory(path.join(dataDir, INCOMING_DIR));
}
