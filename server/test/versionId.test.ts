import { describe, expect, it } from 'vitest';
import {
  MAX_SEQUENCE,
  formatVersionId,
  isVersionId,
  nextVersionId,
  parseVersionId,
} from '../src/versionId.js';

describe('version ids', () => {
  const t = Date.parse('2026-09-28T04:15:23.123Z');

  it('encodes a zero-padded sequence number and the UTC upload time', () => {
    expect(formatVersionId(42, t)).toBe('0000000042-20260928T041523123Z');
    expect(formatVersionId(MAX_SEQUENCE, 0)).toBe('9999999999-19700101T000000000Z');
  });

  it('round-trips', () => {
    expect(parseVersionId(formatVersionId(42, t))).toEqual({ sequence: 42, createdAtMs: t });
  });

  it('sorts by sequence as plain strings, whatever the timestamps say', () => {
    const ids = [1, 2, 9, 10, 99, 100, 12_345].map((seq, i) =>
      // Timestamps deliberately out of order, as after a clock correction.
      formatVersionId(seq, t - i * 86_400_000),
    );
    expect([...ids].sort()).toEqual(ids);
  });

  it('refuses sequences and times it cannot encode', () => {
    expect(() => formatVersionId(0, t)).toThrow(RangeError);
    expect(() => formatVersionId(MAX_SEQUENCE + 1, t)).toThrow(RangeError);
    expect(() => formatVersionId(1.5, t)).toThrow(RangeError);
    expect(() => formatVersionId(1, -1)).toThrow(RangeError);
    expect(() => formatVersionId(1, Date.UTC(10_000, 0))).toThrow(RangeError);
  });

  it.each([
    'latest',
    '',
    '0000000042',
    '20260928T041523123Z',
    '0000000000-20260928T041523123Z', // sequence 0
    '000000042-20260928T041523123Z', // 9-digit sequence
    '00000000042-20260928T041523123Z', // 11-digit sequence
    '0000000042-20260928T041523123', // no Z
    '0000000042-2026-09-28T04:15:23.123Z',
    '0000000042-20261328T041523123Z', // month 13
    '0000000042-20260931T041523123Z', // 31 September
    '0000000042-20260928T251523123Z', // hour 25
    '../0000000042-20260928T041523123Z',
    '0000000042-20260928T041523123Z/../auth',
    '0000000042-20260928T041523123Z.bin',
    '0000000042-20260928T041523123Z\n',
  ])('rejects %j', (value) => {
    expect(isVersionId(value)).toBe(false);
    expect(parseVersionId(value)).toBeNull();
  });

  it('numbers new versions after the newest one and stamps them with the clock as is', () => {
    const newest = formatVersionId(7, t);
    expect(nextVersionId(t + 5, newest)).toEqual({
      version: formatVersionId(8, t + 5),
      sequence: 8,
      createdAtMs: t + 5,
    });
    expect(nextVersionId(t, undefined).sequence).toBe(1);
    // A clock that went backwards (or a newest version stamped in the future) no longer pins
    // new timestamps: the sequence alone keeps the order.
    const afterJump = nextVersionId(t - 86_400_000, formatVersionId(8, t + 365 * 86_400_000));
    expect(afterJump.createdAtMs).toBe(t - 86_400_000);
    expect(afterJump.version > formatVersionId(8, t + 365 * 86_400_000)).toBe(true);
  });
});
