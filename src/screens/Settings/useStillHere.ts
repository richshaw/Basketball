import { useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { UNSAFE_DataRouterContext, useLocation } from 'react-router';

/**
 * For answers that come back later (the backup server's, an import's): a function that
 * says whether the parent is still here, with this component up on the screen it was
 * shown on. An answer that comes after she has left (for the live game, say) says
 * nothing, and takes her nowhere.
 *
 * Both halves matter. The flag is cleared by a layout effect's cleanup, as the component
 * is taken down, not some time after as a passive effect's is. And the router renders a
 * navigation in a transition, so the screen can still be up a moment after she has
 * gone: the router's own state says so at once (read through its context, since
 * react-router has no public hook for it outside rendering).
 */
export function useStillHere(): () => boolean {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const { pathname } = useLocation();
  return useCallback(
    () => mounted.current && (dataRouter?.router.state.location.pathname ?? pathname) === pathname,
    [dataRouter, pathname],
  );
}
