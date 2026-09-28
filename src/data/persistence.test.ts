import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStorageStatus, requestPersistentStorage } from './persistence';

function stubStorage(storage: Partial<StorageManager> | undefined) {
  vi.stubGlobal('navigator', { ...navigator, storage });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPersistentStorage', () => {
  it('asks the browser to persist storage', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({ persist, persisted: () => Promise.resolve(false) });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("doesn't ask again once storage is persisted", async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    stubStorage({ persist, persisted: () => Promise.resolve(true) });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('never throws', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
    stubStorage({ persist: () => Promise.reject(new Error('Denied')) });
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe('getStorageStatus', () => {
  it('reports persistence, usage and quota', async () => {
    stubStorage({
      persisted: () => Promise.resolve(true),
      estimate: () => Promise.resolve({ usage: 1200, quota: 5_000_000 }),
    });
    expect(await getStorageStatus()).toEqual({ persisted: true, usage: 1200, quota: 5_000_000 });
  });

  it('reports what it can when the browser has no storage API or it fails', async () => {
    stubStorage(undefined);
    expect(await getStorageStatus()).toEqual({ persisted: null });
    stubStorage({
      persisted: () => Promise.reject(new Error('Nope')),
      estimate: () => Promise.resolve({ usage: 10 }),
    });
    expect(await getStorageStatus()).toEqual({ persisted: null, usage: 10 });
  });
});
