import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_LIMITS, loadConfig, parseAllowedOrigins } from '../src/config.js';

const MiB = 1024 * 1024;

describe('config', () => {
  it('has sensible defaults for a one-family server', () => {
    const config = loadConfig({});
    expect(config.port).toBe(8080);
    expect(config.dataDir).toMatch(/[/\\]data$/);
    expect(config.allowedOrigins).toEqual([]);
    expect(config.requestTimeoutMs).toBe(60_000);
    expect(config.limits).toEqual(DEFAULT_LIMITS);
    expect(config.limits).toEqual({
      maxBodyBytes: 5 * MiB,
      maxAccountBytes: 50 * MiB,
      maxAccounts: 5,
      maxNewAccountsPerDay: 3,
      minFreeDiskPercent: 20,
      maxConcurrentUploads: 4,
      maxConcurrentNewAccountUploads: 1,
      maxConcurrentUploadsPerIp: 2,
      uploadStallTimeoutMs: 10_000,
      requestsPerIpPerMinute: 120,
      writesPerAccountPerMinute: 20,
      downloadsPerAccountPerMinute: 30,
    });
    expect(config.retention).toEqual({ keepRecent: 20, keepDailyDays: 180 });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      PORT: '9000',
      DATA_DIR: '/data',
      ALLOWED_ORIGINS: 'https://richshaw.github.io, http://localhost:5173',
      REQUEST_TIMEOUT_MS: '30000',
      MAX_BODY_BYTES: '1024',
      MAX_ACCOUNT_BYTES: '4096',
      MAX_ACCOUNTS: '2',
      MAX_NEW_ACCOUNTS_PER_DAY: '1',
      MIN_FREE_DISK_PERCENT: '0',
      MAX_CONCURRENT_UPLOADS: '3',
      MAX_CONCURRENT_NEW_ACCOUNT_UPLOADS: '2',
      MAX_CONCURRENT_UPLOADS_PER_IP: '1',
      UPLOAD_STALL_TIMEOUT_MS: '5000',
      RATE_LIMIT_PER_IP_PER_MINUTE: '5',
      RATE_LIMIT_WRITES_PER_ACCOUNT_PER_MINUTE: '6',
      RATE_LIMIT_DOWNLOADS_PER_ACCOUNT_PER_MINUTE: '7',
      RETENTION_KEEP_RECENT: '8',
      RETENTION_KEEP_DAILY_DAYS: '9',
    });
    expect(config.port).toBe(9000);
    expect(config.dataDir).toBe('/data');
    expect(config.allowedOrigins).toEqual(['https://richshaw.github.io', 'http://localhost:5173']);
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.limits).toEqual({
      maxBodyBytes: 1024,
      maxAccountBytes: 4096,
      maxAccounts: 2,
      maxNewAccountsPerDay: 1,
      minFreeDiskPercent: 0,
      maxConcurrentUploads: 3,
      maxConcurrentNewAccountUploads: 2,
      maxConcurrentUploadsPerIp: 1,
      uploadStallTimeoutMs: 5000,
      requestsPerIpPerMinute: 5,
      writesPerAccountPerMinute: 6,
      downloadsPerAccountPerMinute: 7,
    });
    expect(config.retention).toEqual({ keepRecent: 8, keepDailyDays: 9 });
  });

  it.each([
    ['PORT', 'eighty'],
    ['PORT', '70000'],
    ['PORT', '-1'],
    ['MAX_BODY_BYTES', '0'],
    ['MAX_BODY_BYTES', '1.5'],
    ['MAX_ACCOUNTS', '0'],
    ['MIN_FREE_DISK_PERCENT', '100'],
    ['REQUEST_TIMEOUT_MS', '10'],
    ['UPLOAD_STALL_TIMEOUT_MS', '10'],
    ['MAX_CONCURRENT_UPLOADS', '1'],
    ['RETENTION_KEEP_RECENT', '0'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
  });

  it('requires the per-account budget to fit at least one maximum-size upload', () => {
    expect(() => loadConfig({ MAX_BODY_BYTES: '2048', MAX_ACCOUNT_BYTES: '1024' })).toThrow(
      /MAX_ACCOUNT_BYTES/,
    );
  });

  it('keeps upload slots for existing accounts that first uploads cannot take', () => {
    expect(() =>
      loadConfig({ MAX_CONCURRENT_UPLOADS: '4', MAX_CONCURRENT_NEW_ACCOUNT_UPLOADS: '4' }),
    ).toThrow(/MAX_CONCURRENT_NEW_ACCOUNT_UPLOADS/);
  });

  it('normalizes allowed origins and rejects invalid ones', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins(' , ')).toEqual([]);
    expect(parseAllowedOrigins('https://richshaw.github.io/, https://richshaw.github.io')).toEqual([
      'https://richshaw.github.io',
    ]);
    expect(parseAllowedOrigins('HTTPS://Example.COM:443')).toEqual(['https://example.com']);
    expect(() => parseAllowedOrigins('richshaw.github.io')).toThrow(ConfigError);
    expect(() => parseAllowedOrigins('ftp://example.com')).toThrow(ConfigError);
  });
});
