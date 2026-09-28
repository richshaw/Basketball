import { describe, expect, it } from 'vitest';
import { formatBytes, protectionExplanation, protectionLabel } from './storageInfo';

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [999, '999 bytes'],
    [1000, '1.0 KB'],
    [1234, '1.2 KB'],
    [85_000, '85 KB'],
    [999_400, '999 KB'],
    [999_960, '1.0 MB'],
    [1_234_567, '1.2 MB'],
    [48_000_000, '48 MB'],
    [2_500_000_000, '2.5 GB'],
  ])('%d bytes is %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('shows a dash for nonsense', () => {
    expect(formatBytes(-1)).toBe('–');
    expect(formatBytes(Number.NaN)).toBe('–');
  });
});

describe('storage protection', () => {
  it('answers yes, no or unknown', () => {
    expect(protectionLabel(true)).toBe('Yes');
    expect(protectionLabel(false)).toBe('No');
    expect(protectionLabel(null)).toBe('Unknown');
  });

  it('suggests the Home Screen in a browser tab', () => {
    expect(protectionExplanation(false, false)).toMatch(/Add Hoop Stats to your Home Screen/);
    expect(protectionExplanation(null, false)).toMatch(/Add Hoop Stats to your Home Screen/);
  });

  it('suggests a backup file in the Home Screen app instead', () => {
    expect(protectionExplanation(false, true)).toMatch(/save a backup file/);
    expect(protectionExplanation(false, true)).not.toMatch(/Home Screen/);
  });

  it('reassures when storage is protected', () => {
    expect(protectionExplanation(true, false)).toBe(
      "This browser won't clear your stats to free up space.",
    );
  });
});
