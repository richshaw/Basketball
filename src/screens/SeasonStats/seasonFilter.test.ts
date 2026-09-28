import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_SEASONS,
  clearSessionValues,
  defaultSeasonKey,
  inSeason,
  readRememberedSeason,
  readSessionValue,
  rememberSeason,
  resolveSeasonKey,
  seasonKey,
  seasonOf,
  writeSessionValue,
} from './seasonFilter';

beforeEach(() => {
  clearSessionValues();
});

afterEach(() => {
  clearSessionValues();
});

describe('season keys', () => {
  it('round-trip a season label, even one called "all"', () => {
    expect(seasonOf(seasonKey('Fall 2026'))).toBe('Fall 2026');
    expect(seasonKey('all')).not.toBe(ALL_SEASONS);
    expect(seasonOf(seasonKey('all'))).toBe('all');
    expect(seasonOf(ALL_SEASONS)).toBeNull();
  });

  it('match the games of that season, or every game for all seasons', () => {
    expect(inSeason({ season: 'Fall 2026' }, seasonKey('Fall 2026'))).toBe(true);
    expect(inSeason({ season: 'Winter' }, seasonKey('Fall 2026'))).toBe(false);
    expect(inSeason({}, seasonKey('Fall 2026'))).toBe(false);
    expect(inSeason({}, ALL_SEASONS)).toBe(true);
    expect(inSeason({ season: 'Winter' }, ALL_SEASONS)).toBe(true);
  });
});

describe('defaultSeasonKey', () => {
  it('picks the most recent season with a finished game', () => {
    const seasons = ['Winter 2027', 'Fall 2026', 'Summer 2026'];
    // Winter has only a live game so far, so it has no stats yet.
    const finals = [{ season: 'Fall 2026' }, { season: 'Summer 2026' }];
    expect(defaultSeasonKey(seasons, finals)).toBe(seasonKey('Fall 2026'));
  });

  it('picks all games when no finished game has a season label', () => {
    expect(defaultSeasonKey([], [{}, {}])).toBe(ALL_SEASONS);
    expect(defaultSeasonKey(['Winter'], [{}])).toBe(ALL_SEASONS);
    expect(defaultSeasonKey([], [])).toBe(ALL_SEASONS);
  });
});

describe('resolveSeasonKey', () => {
  const seasons = ['Fall 2026', 'Summer 2026'];
  const finals = [{ season: 'Fall 2026' }, { season: 'Summer 2026' }];

  it('keeps a remembered season that still exists', () => {
    expect(resolveSeasonKey(seasonKey('Summer 2026'), seasons, finals)).toBe(
      seasonKey('Summer 2026'),
    );
    expect(resolveSeasonKey(ALL_SEASONS, seasons, finals)).toBe(ALL_SEASONS);
  });

  it('falls back to the default when nothing is remembered or the season is gone', () => {
    expect(resolveSeasonKey(undefined, seasons, finals)).toBe(seasonKey('Fall 2026'));
    expect(resolveSeasonKey(seasonKey('Spring 2025'), seasons, finals)).toBe(
      seasonKey('Fall 2026'),
    );
  });
});

describe('session memory', () => {
  it('remembers the season for the rest of the session', () => {
    expect(readRememberedSeason()).toBeUndefined();
    rememberSeason(seasonKey('Summer 2026'));
    expect(readRememberedSeason()).toBe(seasonKey('Summer 2026'));
    expect(window.sessionStorage.getItem('hoop-stats:stats:season')).toBe('season:Summer 2026');
  });

  it('ignores stored values it does not recognize', () => {
    window.sessionStorage.setItem('hoop-stats:stats:season', 'garbage');
    expect(readRememberedSeason()).toBeUndefined();
  });

  it('still remembers when sessionStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    writeSessionValue('metric', 'reb');
    expect(readSessionValue('metric')).toBe('reb');
  });

  it('can forget everything it remembered', () => {
    writeSessionValue('metric', 'ast');
    window.sessionStorage.setItem('someone-else', 'keep');
    clearSessionValues();
    expect(readSessionValue('metric')).toBeUndefined();
    expect(window.sessionStorage.getItem('someone-else')).toBe('keep');
    window.sessionStorage.removeItem('someone-else');
  });
});
