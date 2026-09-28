import type { HttpBindings } from '@hono/node-server';
import type { Context, MiddlewareHandler } from 'hono';
import type { FixedWindowRateLimiter } from './rateLimit.js';
import { rateLimitKeyForAddress } from './rateLimit.js';

export const ALLOWED_METHODS = 'GET, PUT, DELETE, OPTIONS';
export const ALLOWED_HEADERS = 'Authorization, Content-Type';
// Retry-After is not CORS-safelisted, so without this the app couldn't read it on 429/503.
export const EXPOSED_HEADERS = 'X-Backup-Version, X-Backup-Created-At, Retry-After';
const PREFLIGHT_MAX_AGE_SECONDS = '86400';
const MAX_LOGGED_PATH_LENGTH = 160;

/**
 * Shortens every 64-hex-char run (account ids, and tokens if a client ever misplaces one) to
 * its first 8 chars, so logs can correlate requests without recording full identifiers.
 */
export function redactIds(text: string): string {
  return text.replace(/[0-9a-fA-F]{64}/g, (id) => `${id.slice(0, 8)}...`);
}

function loggablePath(url: string): string {
  // pathname stays percent-encoded, so it cannot smuggle control characters into the log.
  const redacted = redactIds(new URL(url).pathname);
  return redacted.length > MAX_LOGGED_PATH_LENGTH
    ? `${redacted.slice(0, MAX_LOGGED_PATH_LENGTH)}...`
    : redacted;
}

/** One line per request: method, redacted path, status, duration. No headers, no bodies. */
export function requestLogger(log: (line: string) => void): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    log(`${c.req.method} ${loggablePath(c.req.url)} ${c.res.status} ${ms}ms`);
  };
}

export function describeError(err: unknown): string {
  const text = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
  return redactIds(text);
}

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    headers.set('Strict-Transport-Security', 'max-age=31536000');
    // Backups and listings must never be served from a browser or proxy cache.
    headers.set('Cache-Control', 'no-store');
  };
}

/**
 * CORS for an explicit allow-list of origins. Allowed origins get the full set of CORS headers
 * on every response (errors included, so the app can read 401/413/429 statuses). Any other
 * origin gets no CORS headers at all, and its preflights are refused with 403.
 */
export function cors(allowedOrigins: readonly string[]): MiddlewareHandler {
  const allowed = new Set(allowedOrigins);
  return async (c, next): Promise<Response | void> => {
    const origin = c.req.header('Origin');
    const originAllowed = origin !== undefined && allowed.has(origin);

    if (c.req.method === 'OPTIONS') {
      if (origin === undefined) {
        return c.body(null, 204, { Allow: ALLOWED_METHODS });
      }
      if (!originAllowed) {
        return c.json({ error: 'origin_not_allowed' }, 403, { Vary: 'Origin' });
      }
      return c.body(null, 204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Max-Age': PREFLIGHT_MAX_AGE_SECONDS,
        Vary: 'Origin',
      });
    }

    await next();
    c.res.headers.append('Vary', 'Origin');
    if (originAllowed) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    }
  };
}

/**
 * Rate-limit key for the caller: Fly's proxy puts the real client address in Fly-Client-IP;
 * without it (local runs) we fall back to the socket's remote address.
 */
export function clientKey(c: Context): string {
  const flyClientIp = c.req.header('Fly-Client-IP');
  if (flyClientIp !== undefined && flyClientIp.trim() !== '') {
    return rateLimitKeyForAddress(flyClientIp);
  }
  const bindings = c.env as Partial<HttpBindings> | undefined;
  return rateLimitKeyForAddress(bindings?.incoming?.socket.remoteAddress);
}

export function tooManyRequests(c: Context, retryAfterSeconds: number): Response {
  return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(retryAfterSeconds) });
}

/** Per-client-IP request limit. /health is exempt so platform health checks never trip it. */
export function ipRateLimit(limiter: FixedWindowRateLimiter): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path === '/health') return next();
    const decision = limiter.hit(clientKey(c));
    if (!decision.allowed) return tooManyRequests(c, decision.retryAfterSeconds);
    return next();
  };
}
