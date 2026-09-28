import path from 'node:path';
import type { RetentionPolicy } from './retention.js';

export interface Limits {
  /** Largest accepted upload, in bytes. Larger bodies get 413. */
  maxBodyBytes: number;
  /** Requests per client IP per minute (all endpoints except /health and CORS preflights). */
  requestsPerIpPerMinute: number;
  /** Uploads per account per minute. */
  writesPerAccountPerMinute: number;
  /** New accounts (first uploads) per client IP per hour. */
  newAccountsPerIpPerHour: number;
}

/** Everything the app factory needs. Tests pass their own temp dir, clock and logger. */
export interface AppConfig {
  dataDir: string;
  allowedOrigins: readonly string[];
  limits: Limits;
  retention: RetentionPolicy;
  /** Clock in epoch milliseconds; drives version timestamps, retention and rate limits. */
  now: () => number;
  /** Receives one line per request plus error details. Never given tokens or bodies. */
  log: (line: string) => void;
}

export interface ServerConfig extends AppConfig {
  port: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = {
  maxBodyBytes: 10 * 1024 * 1024,
  requestsPerIpPerMinute: 120,
  writesPerAccountPerMinute: 20,
  newAccountsPerIpPerHour: 10,
};

export const DEFAULT_RETENTION: Readonly<RetentionPolicy> = {
  keepRecent: 20,
  keepDailyDays: 180,
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

function readInt(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be a whole number, got "${raw}"`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}, got ${raw}`);
  }
  return value;
}

/**
 * Parses a comma-separated list of origins such as "https://richshaw.github.io". Entries are
 * normalized to their origin form (so a trailing slash is harmless); anything that is not an
 * http(s) origin is a configuration error.
 */
export function parseAllowedOrigins(value: string | undefined): string[] {
  const origins = new Set<string>();
  for (const entry of (value ?? '').split(',')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new ConfigError(`ALLOWED_ORIGINS entry "${trimmed}" is not a valid URL`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new ConfigError(`ALLOWED_ORIGINS entry "${trimmed}" must use http or https`);
    }
    origins.add(url.origin);
  }
  return [...origins];
}

export function loadConfig(env: Env = process.env): ServerConfig {
  return {
    port: readInt(env, 'PORT', 8080, 1, 65535),
    dataDir: path.resolve(env.DATA_DIR?.trim() || './data'),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    limits: {
      maxBodyBytes: readInt(env, 'MAX_BODY_BYTES', DEFAULT_LIMITS.maxBodyBytes, 1, 1024 ** 3),
      requestsPerIpPerMinute: readInt(
        env,
        'RATE_LIMIT_PER_IP_PER_MINUTE',
        DEFAULT_LIMITS.requestsPerIpPerMinute,
        1,
        1_000_000,
      ),
      writesPerAccountPerMinute: readInt(
        env,
        'RATE_LIMIT_WRITES_PER_ACCOUNT_PER_MINUTE',
        DEFAULT_LIMITS.writesPerAccountPerMinute,
        1,
        1_000_000,
      ),
      newAccountsPerIpPerHour: readInt(
        env,
        'RATE_LIMIT_NEW_ACCOUNTS_PER_IP_PER_HOUR',
        DEFAULT_LIMITS.newAccountsPerIpPerHour,
        1,
        1_000_000,
      ),
    },
    retention: {
      keepRecent: readInt(env, 'RETENTION_KEEP_RECENT', DEFAULT_RETENTION.keepRecent, 1, 100_000),
      keepDailyDays: readInt(
        env,
        'RETENTION_KEEP_DAILY_DAYS',
        DEFAULT_RETENTION.keepDailyDays,
        0,
        100_000,
      ),
    },
    now: Date.now,
    log: (line) => console.log(line),
  };
}
