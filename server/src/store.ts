import { randomBytes } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { mkdir, open, readFile, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isHex64 } from './auth.js';
import { KeyedMutex } from './keyedMutex.js';
import { isVersionId, parseVersionTime } from './versionId.js';

/**
 * Filesystem layout under DATA_DIR:
 *
 *   accounts/<accountId>/auth.json                 {"tokenSha256": "...", "createdAt": "..."}
 *   accounts/<accountId>/versions/<version>.bin    opaque encrypted bytes, exactly as uploaded
 *   trash/                                         deleted accounts on their way out
 *
 * Every file is written to a temp file in the same directory, fsynced, then renamed into place,
 * so a crash never leaves a half-written auth record or backup visible.
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

export type UploadResult =
  { kind: 'received'; tempPath: string; size: number } | { kind: 'too_large' } | { kind: 'empty' };

/** The request body stream failed, usually because the client went away mid-upload. */
export class BodyReadError extends Error {
  override name = 'BodyReadError';
}

const TEMP_PREFIX = '.tmp-';
const VERSION_SUFFIX = '.bin';

function tempName(): string {
  return `${TEMP_PREFIX}${randomBytes(8).toString('hex')}`;
}

export function isErrno(err: unknown, code: string): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === code;
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
  const temp = path.join(dir, tempName());
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

function newestFirst(a: VersionRef, b: VersionRef): number {
  return a.version < b.version ? 1 : a.version > b.version ? -1 : 0;
}

export class BackupStore {
  readonly #accountsDir: string;
  readonly #trashDir: string;
  readonly #locks = new KeyedMutex();

  constructor(dataDir: string) {
    this.#accountsDir = path.join(dataDir, 'accounts');
    this.#trashDir = path.join(dataDir, 'trash');
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

  /** Runs `task` while holding the account's write lock (uploads and deletes). */
  withAccountLock<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    return this.#locks.run(accountId, task);
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

  async createAuth(accountId: string, record: AuthRecord): Promise<void> {
    await mkdir(this.#accountDir(accountId), { recursive: true, mode: 0o700 });
    await atomicWriteFile(
      path.join(this.#accountDir(accountId), 'auth.json'),
      `${JSON.stringify(record)}\n`,
    );
  }

  /** Version ids and timestamps, newest first, without touching file contents. */
  async listVersionRefs(accountId: string): Promise<VersionRef[]> {
    let names: string[];
    try {
      names = await readdir(this.#versionsDir(accountId));
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return [];
      throw err;
    }
    const refs: VersionRef[] = [];
    for (const name of names) {
      if (!name.endsWith(VERSION_SUFFIX)) continue;
      const version = name.slice(0, -VERSION_SUFFIX.length);
      const createdAtMs = parseVersionTime(version);
      if (createdAtMs !== null) refs.push({ version, createdAtMs });
    }
    return refs.sort(newestFirst);
  }

  /** Versions with their sizes, newest first. */
  async listVersions(accountId: string): Promise<StoredVersion[]> {
    const refs = await this.listVersionRefs(accountId);
    const versions = await Promise.all(
      refs.map(async (ref): Promise<StoredVersion | null> => {
        try {
          const { size } = await stat(this.#versionPath(accountId, ref.version));
          return { ...ref, size };
        } catch (err) {
          if (isErrno(err, 'ENOENT')) return null; // pruned while we were listing
          throw err;
        }
      }),
    );
    return versions.filter((v): v is StoredVersion => v !== null);
  }

  async readVersion(accountId: string, version: string): Promise<Buffer<ArrayBuffer> | null> {
    try {
      return await readFile(this.#versionPath(accountId, version));
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return null;
      throw err;
    }
  }

  /**
   * Streams the request body into a temp file next to the account's versions, stopping as soon
   * as it exceeds `maxBytes` (so oversized uploads are never buffered or stored in full).
   * On success the caller must `commitUpload` or `discardUpload` the temp file.
   */
  async receiveUpload(
    accountId: string,
    body: ReadableStream<Uint8Array> | null,
    maxBytes: number,
  ): Promise<UploadResult> {
    const dir = this.#versionsDir(accountId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tempPath = path.join(dir, tempName());
    let size = 0;
    let tooLarge = false;
    try {
      const handle = await open(tempPath, 'wx', 0o600);
      try {
        if (body !== null) {
          const reader = body.getReader();
          try {
            for (;;) {
              const chunk = await reader.read().catch((err: unknown) => {
                throw new BodyReadError('request body could not be read', { cause: err });
              });
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

  async commitUpload(accountId: string, tempPath: string, version: string): Promise<void> {
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
   * Removes temp files left behind by a crash. Only call while holding the account lock: then
   * no upload for this account can be in flight, so every temp file found is stale.
   */
  async removeStaleTempFiles(accountId: string): Promise<void> {
    for (const dir of [this.#accountDir(accountId), this.#versionsDir(accountId)]) {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (err) {
        if (isErrno(err, 'ENOENT')) continue;
        throw err;
      }
      for (const name of names) {
        if (name.startsWith(TEMP_PREFIX)) await rm(path.join(dir, name), { force: true });
      }
    }
  }

  /** Undoes the directories created by a failed first upload (rmdir only removes empty dirs). */
  async removeEmptyAccountDirs(accountId: string): Promise<void> {
    try {
      await rmdir(this.#versionsDir(accountId));
      await rmdir(this.#accountDir(accountId));
    } catch {
      // Not empty or already gone: nothing to undo.
    }
  }

  /**
   * Deletes an account and all its versions. The account directory is first renamed into
   * trash/ (atomic), so the account vanishes in one step even if the process dies while the
   * files are being removed; leftovers in trash/ are cleared on the next start.
   */
  async deleteAccount(accountId: string): Promise<boolean> {
    await mkdir(this.#trashDir, { recursive: true, mode: 0o700 });
    const trashed = path.join(this.#trashDir, randomBytes(12).toString('hex'));
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
 * Startup check: creates the directory layout, finishes deletions interrupted by a restart,
 * and fails fast with a clear error if the data directory is not writable (for example a
 * volume mounted with the wrong ownership).
 */
export async function prepareDataDir(dataDir: string): Promise<void> {
  await mkdir(path.join(dataDir, 'accounts'), { recursive: true, mode: 0o700 });
  const trash = path.join(dataDir, 'trash');
  await rm(trash, { recursive: true, force: true });
  await mkdir(trash, { recursive: true, mode: 0o700 });
  const probe = path.join(dataDir, `${TEMP_PREFIX}write-check`);
  await atomicWriteFile(probe, 'ok\n');
  await rm(probe, { force: true });
}
