import { matchPath } from 'react-router';
import { describe, expect, it } from 'vitest';
import { paths, routePatterns } from './routes';

describe('paths', () => {
  it('builds game URLs', () => {
    expect(paths.gameReport('42')).toBe('/games/42');
    expect(paths.trackGame('abc')).toBe('/games/abc/track');
  });

  it('encodes ids so they stay a single path segment', () => {
    expect(paths.gameReport('a/b c')).toBe('/games/a%2Fb%20c');
  });

  it('produces URLs that match the router patterns', () => {
    expect(matchPath(routePatterns.gameReport, paths.gameReport('g-1'))?.params.gameId).toBe('g-1');
    expect(matchPath(routePatterns.trackGame, paths.trackGame('7'))?.params.gameId).toBe('7');
    expect(matchPath(routePatterns.newGame, paths.newGame)).not.toBeNull();
    expect(matchPath(routePatterns.restoreBackup, paths.restoreBackup())).not.toBeNull();
    expect(matchPath(routePatterns.devUi, paths.devUi)).not.toBeNull();
  });

  it('says where the restore screen was opened from, and which Settings section to show', () => {
    expect(paths.restoreBackup()).toBe('/restore');
    expect(paths.restoreBackup('settings')).toBe('/restore');
    expect(paths.restoreBackup('games')).toBe('/restore?from=games');
    expect(paths.settingsSection('cloud-backup')).toBe('/settings?section=cloud-backup');
  });
});
