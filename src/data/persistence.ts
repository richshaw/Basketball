/**
 * Storage durability. Browsers may evict a site's IndexedDB under storage pressure
 * unless it's "persisted"; asking once at startup makes that much less likely.
 * (Home-screen apps on iOS get durable storage; Safari tabs may not.)
 */

export interface StorageStatus {
  /** true if the browser promised not to evict our data; null if it can't say. */
  persisted: boolean | null;
  /** Bytes used by this app, when the browser reports it. */
  usage?: number;
  /** Bytes this app may use, when the browser reports it. */
  quota?: number;
}

/** `navigator.storage`, which is missing in older browsers and insecure (http) pages. */
function storageManager(): StorageManager | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

/** Asks the browser to keep our data. Resolves to whether storage is persisted; never throws. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = storageManager();
    if (typeof storage?.persist !== 'function') return false;
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Whether storage is persisted, plus usage and quota where available. Never throws. */
export async function getStorageStatus(): Promise<StorageStatus> {
  const storage = storageManager();
  const status: StorageStatus = { persisted: null };
  try {
    if (typeof storage?.persisted === 'function') status.persisted = await storage.persisted();
  } catch {
    // Unknown: leave it null.
  }
  try {
    if (typeof storage?.estimate === 'function') {
      const { usage, quota } = await storage.estimate();
      if (usage !== undefined) status.usage = usage;
      if (quota !== undefined) status.quota = quota;
    }
  } catch {
    // No estimate available.
  }
  return status;
}
