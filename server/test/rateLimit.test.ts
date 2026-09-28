import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter, rateLimitKeyForAddress } from '../src/rateLimit.js';

describe('FixedWindowRateLimiter', () => {
  it('allows `limit` hits per window, then rejects with Retry-After, then resets', () => {
    let now = 1_000_000;
    const limiter = new FixedWindowRateLimiter(3, 60_000, () => now);
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now += 45_500;
    expect(limiter.hit('a')).toEqual({ allowed: false, retryAfterSeconds: 15 });
    expect(limiter.hit('b')).toEqual({ allowed: true }); // other keys are independent
    now += 14_500;
    expect(limiter.hit('a')).toEqual({ allowed: true });
  });

  it('can refund a hit within the same window, but not into a new one', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, 60_000, () => now);
    expect(limiter.hit('a')).toEqual({ allowed: true });
    limiter.refund('a');
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a').allowed).toBe(false);

    now += 60_000; // new window: a late refund must not create extra allowance
    limiter.refund('a');
    expect(limiter.hit('a')).toEqual({ allowed: true });
    expect(limiter.hit('a').allowed).toBe(false);
    limiter.refund('unknown-key'); // harmless
  });

  it('forgets idle keys', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, 1000, () => now);
    for (let i = 0; i < 50; i += 1) limiter.hit(`key-${i}`);
    expect(limiter.size).toBe(50);
    now += 5000;
    limiter.hit('fresh');
    expect(limiter.size).toBe(1);
  });
});

describe('rateLimitKeyForAddress', () => {
  it('uses IPv4 addresses as-is, including IPv4-mapped IPv6', () => {
    expect(rateLimitKeyForAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKeyForAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(rateLimitKeyForAddress(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('groups IPv6 addresses by /64', () => {
    const a = rateLimitKeyForAddress('2001:db8:abcd:12::1');
    const b = rateLimitKeyForAddress('2001:0db8:abcd:0012:ffff:ffff:ffff:ffff');
    const c = rateLimitKeyForAddress('2001:db8:abcd:13::1');
    expect(a).toBe('2001:db8:abcd:12::/64');
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(rateLimitKeyForAddress('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKeyForAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(rateLimitKeyForAddress('64:ff9b::192.0.2.33')).toBe('64:ff9b:0:0::/64');
  });

  it('falls back to a shared key when there is no address', () => {
    expect(rateLimitKeyForAddress(undefined)).toBe('unknown');
    expect(rateLimitKeyForAddress('')).toBe('unknown');
  });
});
