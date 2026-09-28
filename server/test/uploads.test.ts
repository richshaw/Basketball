import { describe, expect, it } from 'vitest';
import { UploadSlots, UploadTracker } from '../src/uploads.js';

const ID = 'a'.repeat(64);

describe('UploadTracker', () => {
  it('hands out increasing sequence numbers, seeded once from disk', async () => {
    const tracker = new UploadTracker();
    let seeded = 0;
    const highestStored = () => {
      seeded += 1;
      return Promise.resolve(41);
    };
    const first = await tracker.begin(ID, highestStored);
    const second = await tracker.begin(ID, highestStored);
    expect([first.sequence, second.sequence]).toEqual([42, 43]);
    expect(seeded).toBe(1);
  });

  it('forgets an account once nothing is in flight, then re-seeds from disk', async () => {
    const tracker = new UploadTracker();
    await tracker.begin(ID, () => Promise.resolve(0));
    await tracker.begin(ID, () => Promise.resolve(0));
    tracker.end(ID);
    expect(tracker.trackedAccounts).toBe(1);
    tracker.end(ID);
    expect(tracker.trackedAccounts).toBe(0);
    // A failed upload's number may be handed out again: nothing was stored under it.
    expect((await tracker.begin(ID, () => Promise.resolve(1))).sequence).toBe(2);
  });

  it('invalidates uploads in flight when the account is deleted', async () => {
    const tracker = new UploadTracker();
    const before = await tracker.begin(ID, () => Promise.resolve(5));
    expect(tracker.isCurrent(ID, before)).toBe(true);

    tracker.accountDeleted(ID);
    expect(tracker.isCurrent(ID, before)).toBe(false);

    // Uploads started after the delete are current, and count from what is on disk again.
    const after = await tracker.begin(ID, () => Promise.resolve(0));
    expect(after.sequence).toBe(1);
    expect(tracker.isCurrent(ID, after)).toBe(true);
    expect(tracker.isCurrent(ID, before)).toBe(false);
  });

  it('cleans up when seeding fails', async () => {
    const tracker = new UploadTracker();
    await expect(tracker.begin(ID, () => Promise.reject(new Error('disk')))).rejects.toThrow(
      'disk',
    );
    expect(tracker.trackedAccounts).toBe(0);
  });
});

describe('UploadSlots', () => {
  it('keeps slots for existing accounts that first uploads cannot take', () => {
    const slots = new UploadSlots({ total: 3, newAccounts: 1, perClient: 5 });
    const stranger = slots.acquire('203.0.113.1', true);
    expect(stranger.ok).toBe(true);
    expect(slots.acquire('203.0.113.2', true)).toEqual({ ok: false, reason: 'server_busy' });
    // The family's existing accounts still get the remaining two.
    expect(slots.acquire('198.51.100.7', false).ok).toBe(true);
    expect(slots.acquire('198.51.100.7', false).ok).toBe(true);
    expect(slots.acquire('198.51.100.8', false)).toEqual({ ok: false, reason: 'server_busy' });
  });

  it('limits concurrent uploads per client', () => {
    const slots = new UploadSlots({ total: 10, newAccounts: 1, perClient: 2 });
    const a = slots.acquire('client', false);
    const b = slots.acquire('client', false);
    expect(slots.acquire('client', false)).toEqual({ ok: false, reason: 'client_busy' });
    expect(slots.acquire('other', false).ok).toBe(true);
    if (a.ok) a.release();
    expect(slots.acquire('client', false).ok).toBe(true);
    if (b.ok) b.release();
  });

  it('gives every slot back exactly once', () => {
    const slots = new UploadSlots({ total: 2, newAccounts: 1, perClient: 2 });
    const first = slots.acquire('client', true);
    if (!first.ok) throw new Error('expected a slot');
    first.release();
    first.release(); // double release is harmless
    expect(slots.inUse).toBe(0);
    expect(slots.acquire('client', true).ok).toBe(true);
    expect(slots.acquire('client', false).ok).toBe(true);
    expect(slots.inUse).toBe(2);
  });
});
