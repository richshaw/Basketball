import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_LIMITS, loadConfig, parseAllowedOrigins } from '../src/config.js';

describe('config', () => {
  it('has sensible defaults', () => {
    const config = loadConfig({});
    expect(config.port).toBe(8080);
    expect(config.dataDir).toMatch(/[/\\]data$/);
    expect(config.allowedOrigins).toEqual([]);
    expect(config.limits).toEqual(DEFAULT_LIMITS);
    expect(config.limits.maxBodyBytes).toBe(10 * 1024 * 1024);
    expect(config.retention).toEqual({ keepRecent: 20, keepDailyDays: 180 });
  });

  it('reads overrides from the environment', () => {
    const config = loadConfig({
      PORT: '9000',
      DATA_DIR: '/data',
      ALLOWED_ORIGINS: 'https://richshaw.github.io, http://localhost:5173',
      MAX_BODY_BYTES: '1024',
      RATE_LIMIT_PER_IP_PER_MINUTE: '5',
      RATE_LIMIT_WRITES_PER_ACCOUNT_PER_MINUTE: '6',
      RATE_LIMIT_NEW_ACCOUNTS_PER_IP_PER_HOUR: '7',
      RETENTION_KEEP_RECENT: '8',
      RETENTION_KEEP_DAILY_DAYS: '9',
    });
    expect(config.port).toBe(9000);
    expect(config.dataDir).toBe('/data');
    expect(config.allowedOrigins).toEqual(['https://richshaw.github.io', 'http://localhost:5173']);
    expect(config.limits).toEqual({
      maxBodyBytes: 1024,
      requestsPerIpPerMinute: 5,
      writesPerAccountPerMinute: 6,
      newAccountsPerIpPerHour: 7,
    });
    expect(config.retention).toEqual({ keepRecent: 8, keepDailyDays: 9 });
  });

  it.each([
    ['PORT', 'eighty'],
    ['PORT', '70000'],
    ['PORT', '-1'],
    ['MAX_BODY_BYTES', '0'],
    ['MAX_BODY_BYTES', '1.5'],
    ['RETENTION_KEEP_RECENT', '0'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
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
