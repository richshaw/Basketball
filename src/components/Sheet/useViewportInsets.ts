import { useSyncExternalStore } from 'react';

/**
 * How much of the layout viewport the user can't see, in CSS pixels: at the bottom
 * the on-screen keyboard, and at the top whatever iOS scrolled away to reveal the
 * focused field. iOS doesn't shrink the layout viewport for its keyboard, so a
 * bottom-anchored sheet has to lift itself by `bottom`.
 */
export interface ViewportInsets {
  top: number;
  bottom: number;
}

const noInsets: ViewportInsets = { top: 0, bottom: 0 };

export function readViewportInsets(
  view: Pick<Window, 'innerHeight' | 'visualViewport'>,
): ViewportInsets {
  const viewport = view.visualViewport;
  // No Visual Viewport API, or the user pinch-zoomed: nothing a sheet should dodge.
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01) return noInsets;
  return {
    top: Math.max(0, Math.round(viewport.offsetTop)),
    bottom: Math.max(0, Math.round(view.innerHeight - viewport.offsetTop - viewport.height)),
  };
}

function subscribe(onChange: () => void) {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener('resize', onChange);
  viewport.addEventListener('scroll', onChange);
  return () => {
    viewport.removeEventListener('resize', onChange);
    viewport.removeEventListener('scroll', onChange);
  };
}

const subscribeToNothing = () => () => {};

// Snapshots are strings, so an unchanged viewport never causes a re-render.
const currentInsets = () => {
  const { top, bottom } = readViewportInsets(window);
  return `${top} ${bottom}`;
};
const zeroInsets = () => '0 0';

/** The live viewport insets while `active` (e.g. while a sheet is open), zeros otherwise. */
export function useViewportInsets(active: boolean): ViewportInsets {
  const snapshot = useSyncExternalStore(
    active ? subscribe : subscribeToNothing,
    active ? currentInsets : zeroInsets,
    zeroInsets,
  );
  const [top = 0, bottom = 0] = snapshot.split(' ').map(Number);
  return { top, bottom };
}
