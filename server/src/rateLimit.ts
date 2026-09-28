import { isIPv4, isIPv6 } from 'node:net';

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-memory fixed-window counter: at most `limit` hits per key per `windowMs`.
 * State lives in this process only, which is fine for a single small machine. Expired buckets
 * are swept once per window so memory stays proportional to recently active keys.
 */
export class FixedWindowRateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #nextSweepAt = 0;

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  /** Records a hit for `key` unless it is over the limit. Rejected hits are not counted. */
  hit(key: string): RateLimitDecision {
    const now = this.#now();
    this.#sweep(now);
    let bucket = this.#buckets.get(key);
    if (bucket === undefined || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.#windowMs };
      this.#buckets.set(key, bucket);
    }
    if (bucket.count >= this.#limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }
    bucket.count += 1;
    return { allowed: true };
  }

  /**
   * Gives back one hit for `key`, e.g. for an upload that failed through no fault of the client
   * (signal dropped mid-upload). No-op if the window that was charged has already ended.
   */
  refund(key: string): void {
    const bucket = this.#buckets.get(key);
    if (bucket !== undefined && bucket.count > 0 && this.#now() < bucket.resetAt) {
      bucket.count -= 1;
    }
  }

  /** Number of keys currently tracked (for tests and diagnostics). */
  get size(): number {
    return this.#buckets.size;
  }

  #sweep(now: number): void {
    if (now < this.#nextSweepAt) return;
    for (const [key, bucket] of this.#buckets) {
      if (now >= bucket.resetAt) this.#buckets.delete(key);
    }
    this.#nextSweepAt = now + this.#windowMs;
  }
}

/** Expands an IPv6 address (already validated with isIPv6) into its 8 hextets. */
function ipv6Hextets(address: string): number[] {
  let text = address.toLowerCase();
  // Convert an embedded dotted IPv4 tail (e.g. ::ffff:1.2.3.4) into two hextets.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (isIPv4(tail)) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = rest === undefined || rest === '' ? [] : rest.split(':');
  const zeros =
    rest === undefined ? [] : Array<string>(8 - headParts.length - tailParts.length).fill('0');
  return [...headParts, ...zeros, ...tailParts].map((part) => parseInt(part, 16));
}

/**
 * Turns a client address into a rate-limit key. IPv4 addresses (including IPv4-mapped IPv6)
 * are used as-is. IPv6 addresses are grouped by /64, because a single phone or household
 * typically controls a whole /64 and could otherwise rotate addresses to dodge the limit.
 */
export function rateLimitKeyForAddress(address: string | undefined): string {
  if (address === undefined) return 'unknown';
  let addr = address.trim();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  if (isIPv4(addr)) return addr;
  if (isIPv6(addr)) {
    const hextets = ipv6Hextets(addr);
    const mapped = hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff;
    if (mapped) {
      const [hi = 0, lo = 0] = hextets.slice(6);
      return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    }
    return `${hextets
      .slice(0, 4)
      .map((h) => h.toString(16))
      .join(':')}::/64`;
  }
  return addr === '' ? 'unknown' : addr.slice(0, 64);
}
