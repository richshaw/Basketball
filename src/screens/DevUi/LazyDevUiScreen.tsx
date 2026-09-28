import { lazy, Suspense } from 'react';

const DevUiScreen = lazy(() =>
  import('./DevUiScreen').then((module) => ({ default: module.DevUiScreen })),
);

/**
 * The component gallery, loaded only when someone opens #/dev/ui, so it stays out of
 * the startup bundle. (The service worker still precaches it for offline use.)
 */
export function LazyDevUiScreen() {
  return (
    <Suspense fallback={null}>
      <DevUiScreen />
    </Suspense>
  );
}
