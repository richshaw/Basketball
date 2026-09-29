/**
 * Every URL in the app is built here. Link with `paths.*`; never hand-build a URL.
 *
 * The app uses a hash router (GitHub Pages has no SPA rewrites), so these paths
 * appear after the `#` in the address bar, e.g. `.../Basketball/#/games/42/track`.
 */

/** Games are keyed by string ids (crypto.randomUUID in the data layer). */
export type GameId = string;

/** Route patterns for the router table (src/router.tsx). */
export const routePatterns = {
  home: '/',
  stats: '/stats',
  settings: '/settings',
  newGame: '/games/new',
  gameReport: '/games/:gameId',
  trackGame: '/games/:gameId/track',
  /** Restore from a cloud backup code: on a new phone, or after "Erase all data". */
  restoreBackup: '/restore',
  /** Hidden gallery of the shared components (not linked from the app). */
  devUi: '/dev/ui',
} as const;

/** Settings sections a link can open Settings at (`?section=`). */
export type SettingsSection = 'cloud-backup';

/** Where the restore screen was opened from: its back link returns there (`?from=`). */
export type RestoreOrigin = 'games' | 'settings';

const gamePath = (gameId: GameId) => `/games/${encodeURIComponent(gameId)}`;

/** Concrete URLs to link or navigate to. */
export const paths = {
  home: routePatterns.home,
  stats: routePatterns.stats,
  settings: routePatterns.settings,
  /** Settings, scrolled to one of its sections (e.g. from the cloud backup banner). */
  settingsSection: (section: SettingsSection) => `${routePatterns.settings}?section=${section}`,
  newGame: routePatterns.newGame,
  gameReport: (gameId: GameId) => gamePath(gameId),
  trackGame: (gameId: GameId) => `${gamePath(gameId)}/track`,
  /** Restore from a backup code; opened from Games, its back link returns to Games. */
  restoreBackup: (from: RestoreOrigin = 'settings') =>
    from === 'settings'
      ? routePatterns.restoreBackup
      : `${routePatterns.restoreBackup}?from=${from}`,
  devUi: routePatterns.devUi,
} as const;
