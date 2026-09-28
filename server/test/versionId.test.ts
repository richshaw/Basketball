import { describe, expect, it } from 'vitest';
import { formatVersionId, isVersionId, nextVersionId, parseVersionTime } from '../src/versionId.js';

describe('version ids', () => {
  const t = Date.parse('2026-09-28T04:15:23.123Z');

  it('encodes a fixed-width UTC timestamp plus a random suffix', () => {
    expect(formatVersionId(t, '0a1b2c3d')).toBe('20260928T041523123Z-0a1b2c3d');
    expect(formatVersionId(t)).toMatch(/^20260928T041523123Z-[0-9a-f]{8}$/);
  });

  it('round-trips the timestamp', () => {
    expect(parseVersionTime(formatVersionId(t))).toBe(t);
    expect(parseVersionTime('19700101T000000000Z-00000000')).toBe(0);
  });

  it('sorts chronologically as plain strings', () => {
    const times = [0, 1, 999, 1000, 59_999, 86_399_999, 86_400_000, t, t + 1, Date.UTC(9999, 0)];
    const idsInTimeOrder = times.map((ms) => formatVersionId(ms, 'ffffffff'));
    expect([...idsInTimeOrder].sort()).toEqual(idsInTimeOrder);
  });

  it.each([
    'latest',
    '',
    '20260928T041523123Z',
    '20260928T041523123Z-0A1B2C3D', // uppercase
    '20260928T041523123Z-0a1b2c3', // short suffix
    '20260928T041523123Z-0a1b2c3d4', // long suffix
    '20260928T041523123-0a1b2c3d', // no Z
    '2026-09-28T04:15:23.123Z-0a1b2c3d',
    '20261328T041523123Z-0a1b2c3d', // month 13
    '20260931T041523123Z-0a1b2c3d', // 31 September
    '20260928T251523123Z-0a1b2c3d', // hour 25
    '../20260928T041523123Z-0a1b2c3d',
    '20260928T041523123Z-0a1b2c3d/../auth',
    '20260928T041523123Z-0a1b2c3d.bin',
    '20260928T041523123Z-0a1b2c3d\n',
  ])('rejects %j', (value) => {
    expect(isVersionId(value)).toBe(false);
    expect(parseVersionTime(value)).toBeNull();
  });

  it('stamps new versions after the newest existing one', () => {
    const existing = formatVersionId(t, '00000000');
    expect(nextVersionId(t + 5, existing).createdAtMs).toBe(t + 5); // normal case
    expect(nextVersionId(t, existing).createdAtMs).toBe(t + 1); // same millisecond
    expect(nextVersionId(t - 60_000, existing).createdAtMs).toBe(t + 1); // clock went back
    expect(nextVersionId(t, undefined).createdAtMs).toBe(t); // first version
    const next = nextVersionId(t, existing);
    expect(next.version > existing).toBe(true);
  });
});
