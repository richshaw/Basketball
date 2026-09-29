import { describe, expect, it, vi } from 'vitest';
import { compareIds, newId } from './id';

const UUID_V4 = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

describe('newId', () => {
  it('makes unique v4 UUIDs', () => {
    const ids = Array.from({ length: 200 }, newId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('falls back to getRandomValues outside secure contexts', () => {
    // Plain http (e.g. a LAN address) has getRandomValues but no randomUUID.
    const getRandomValues = vi.fn(crypto.getRandomValues.bind(crypto));
    vi.stubGlobal('crypto', { getRandomValues });
    try {
      const ids = [newId(), newId()];
      expect(getRandomValues).toHaveBeenCalledTimes(2);
      expect(ids[0]).toMatch(UUID_V4);
      expect(ids[0]).not.toBe(ids[1]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('still works with no Web Crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(newId()).toMatch(UUID_V4);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('compareIds', () => {
  it('orders by code unit, like the default sort, whatever the locale', () => {
    expect(['b', 'B', 'a1', 'a', 'A'].sort(compareIds)).toEqual(['A', 'B', 'a', 'a1', 'b']);
    expect(compareIds('game-2', 'game-2')).toBe(0);
  });
});
