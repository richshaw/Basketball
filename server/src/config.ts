import path from 'node:path';
import type { RetentionPolicy } from './retention.js';
import type { DiskSpace } from './store.js';
import { readDiskSpace } from './store.js';

const MiB = 1024 * 1024;

export interface Limits {
  /** Largest accepted upload, in bytes. Larger bodies get 413. */
  maxBodyBytes: number;
  /** Storage budget per account; the oldest versions are pruned to stay under it. */
  maxAccountBytes: number;
  /** Accounts the server will hold in total (it serves one family). */
  maxAccounts: number;
  /** New accounts per rolling 24 hours, across all clients. */
  maxNewAccountsPerDay: number;
  /** Refuse uploads (507) while free disk space is below this share of the disk. 0 = off. */
  minFreeDiskPercent: number;
  /** Uploads being received at the same time, across all clients. */
  maxConcurrentUploads: number;
  /** Requests per client IP per minute (all endpoints except /health and CORS preflights). */
  requestsPerIpPerMinute: number;
  /** Uploads per account per minute. */
  writesPerAccountPerMinute: number;
  /** Backup downloads per account per minute. */
  downloadsPerAccountPerMinute: number;
}

/** Everything the app factory needs. Tests pass their own temp dir, clock, disk and logger. */
export interface AppConfig {
  dataDir: string;
  allowedOrigins: readonly string[];
  limits: Limits;
  retention: RetentionPolicy;
  /** Clock in epoch milliseconds; drives version timestamps, retention and rate limits. */
  now: () => number;
  /** Receives one line per request plus error details. Never given tokens or bodies. */
  log: (line: string) => void;
  /** Free and total bytes of the filesystem holding `dataDir`. */
  diskSpace: (dir: string) => Promise<DiskSpace>;
}

export interface ServerConfig extends AppConfig {
  port: number;
  /** Interface to listen on; all interfaces when omitted. */
  hostname?: string;
  /** Longest time a client may take to send a whole request (408 after that). */
  requestTimeoutMs: number;
}

export const DEFAULT_LIMITS: Readonly<Limits> = {
  maxBodyBytes: 5 * MiB,
  maxAccountBytes: 50 * MiB,
  maxAccounts: 5,
  maxNewAccountsPerDay: 3,
  minFreeDiskPercent: 20,
  maxConcurrentUploads: 4,
  requestsPerIpPerMinute: 120,
  writesPerAccountPerMinute: 20,
  downloadsPerAccountPerMinute: 30,
};

export const DEFAULT_RETENTION: Readonly<RetentionPolicy> = {
  keepRecent: 20,
  keepDailyDays: 180,
};

export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

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
  const d = DEFAULT_LIMITS;
  const limits: Limits = {
    maxBodyBytes: readInt(env, 'MAX_BODY_BYTES', d.maxBodyBytes, 1, 1024 * MiB),
    maxAccountBytes: readInt(env, 'MAX_ACCOUNT_BYTES', d.maxAccountBytes, 1, 1024 ** 4),
    maxAccounts: readInt(env, 'MAX_ACCOUNTS', d.maxAccounts, 1, 1_000_000),
    maxNewAccountsPerDay: readInt(env, 'MAX_NEW_ACCOUNTS_PER_DAY', d.maxNewAccountsPerDay, 1, 1e6),
    minFreeDiskPercent: readInt(env, 'MIN_FREE_DISK_PERCENT', d.minFreeDiskPercent, 0, 99),
    maxConcurrentUploads: readInt(env, 'MAX_CONCURRENT_UPLOADS', d.maxConcurrentUploads, 1, 1000),
    requestsPerIpPerMinute: readInt(
      env,
      'RATE_LIMIT_PER_IP_PER_MINUTE',
      d.requestsPerIpPerMinute,
      1,
      1_000_000,
    ),
    writesPerAccountPerMinute: readInt(
      env,
      'RATE_LIMIT_WRITES_PER_ACCOUNT_PER_MINUTE',
      d.writesPerAccountPerMinute,
      1,
      1_000_000,
    ),
    downloadsPerAccountPerMinute: readInt(
      env,
      'RATE_LIMIT_DOWNLOADS_PER_ACCOUNT_PER_MINUTE',
      d.downloadsPerAccountPerMinute,
      1,
      1_000_000,
    ),
  };
  if (limits.maxAccountBytes < limits.maxBodyBytes) {
    throw new ConfigError('MAX_ACCOUNT_BYTES must be at least MAX_BODY_BYTES');
  }
  return {
    port: readInt(env, 'PORT', 8080, 1, 65535),
    dataDir: path.resolve(env.DATA_DIR?.trim() || './data'),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    requestTimeoutMs: readInt(
      env,
      'REQUEST_TIMEOUT_MS',
      DEFAULT_REQUEST_TIMEOUT_MS,
      1000,
      3_600_000,
    ),
    limits,
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
    diskSpace: readDiskSpace,
  };
}
