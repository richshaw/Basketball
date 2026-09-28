import { describe, expect, it } from 'vitest';
import { APP_VERSION, formatAppVersion } from './appVersion';

describe('formatAppVersion', () => {
  it('shows the version and the commit', () => {
    expect(formatAppVersion('1.2.0', '3f9c2ab')).toBe('1.2.0 (3f9c2ab)');
  });

  it('falls back to the version alone when the build had no git', () => {
    expect(formatAppVersion('1.2.0', '')).toBe('1.2.0');
  });

  it('falls back to the commit alone without a version', () => {
    expect(formatAppVersion('', '3f9c2ab')).toBe('3f9c2ab');
  });

  it('says Unknown when neither is known', () => {
    expect(formatAppVersion(' ', '')).toBe('Unknown');
  });
});

describe('APP_VERSION', () => {
  it('comes from package.json at build time', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+( \([\da-f]{4,}\))?$/);
  });
});
