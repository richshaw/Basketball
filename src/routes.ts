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
} as const;

const gamePath = (gameId: GameId) => `/games/${encodeURIComponent(gameId)}`;

/** Concrete URLs to link or navigate to. */
export const paths = {
  home: routePatterns.home,
  stats: routePatterns.stats,
  settings: routePatterns.settings,
  newGame: routePatterns.newGame,
  gameReport: (gameId: GameId) => gamePath(gameId),
  trackGame: (gameId: GameId) => `${gamePath(gameId)}/track`,
} as const;
