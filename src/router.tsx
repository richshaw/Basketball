import { createHashRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell } from '@/components/AppShell/AppShell';
import { paths, routePatterns } from '@/routes';
import { DevUiScreen } from '@/screens/DevUi/DevUiScreen';
import { ErrorScreen } from '@/screens/Error/ErrorScreen';
import { GameReportScreen } from '@/screens/GameReport/GameReportScreen';
import { HomeScreen } from '@/screens/Home/HomeScreen';
import { NewGameScreen } from '@/screens/NewGame/NewGameScreen';
import { SeasonStatsScreen } from '@/screens/SeasonStats/SeasonStatsScreen';
import { SettingsScreen } from '@/screens/Settings/SettingsScreen';
import { TrackGameScreen } from '@/screens/TrackGame/TrackGameScreen';

/** The route table, shared by the app (hash router) and tests (memory router). */
export const appRoutes: RouteObject[] = [
  {
    ErrorBoundary: ErrorScreen,
    children: [
      {
        // Tab screens: tab bar + update banner.
        Component: AppShell,
        children: [
          { path: routePatterns.home, Component: HomeScreen },
          { path: routePatterns.stats, Component: SeasonStatsScreen },
          { path: routePatterns.settings, Component: SettingsScreen },
        ],
      },
      // Full-screen routes: no tab bar, no update banner.
      { path: routePatterns.newGame, Component: NewGameScreen },
      { path: routePatterns.gameReport, Component: GameReportScreen },
      { path: routePatterns.trackGame, Component: TrackGameScreen },
      // Component gallery for reviews and screenshots; nothing links here.
      { path: routePatterns.devUi, Component: DevUiScreen },
      { path: '*', element: <Navigate to={paths.home} replace /> },
    ],
  },
];

/**
 * Hash routing (`#/stats`): GitHub Pages can't rewrite deep links to index.html,
 * and hash URLs always load the cached index.html when offline.
 */
export function createAppRouter() {
  return createHashRouter(appRoutes);
}
