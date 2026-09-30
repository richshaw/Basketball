/**
 * How long the second tap of a quick double tap is caught at the spot of the first,
 * when the first opened or closed a sheet: from the end of the first tap (and from each
 * one caught since, so a triple tap acts once too). About the longest gap of a double
 * tap: a tap there once she has seen what's under it counts, and a tap anywhere else
 * counts at once.
 */
export const SECOND_TAP_MS = 350;

/** A tap: where it went down, and when it ended (performance.now()). */
interface Tap {
  x: number;
  y: number;
  at: number;
}

let listening = false;
/** Where the pointer went down, while it's down. */
let down: { x: number; y: number } | undefined;
let lastTap: Tap | undefined;
/** Removes each catcher on screen. */
const catchers = new Set<() => void>();

/**
 * Starts noting where each tap went down and when it ended, for catchSecondTap (once
 * for the page: UiProviders calls it as the app starts, so the tap that opens a screen's
 * first sheet is noted too; Sheet also does). Noted before anything else hears of the
 * tap, and whatever the tap then does.
 */
export function listenForTaps(): void {
  if (listening) return;
  listening = true;
  const options = { capture: true, passive: true } as const;
  window.addEventListener(
    'pointerdown',
    (event) => {
      down = { x: event.clientX, y: event.clientY };
    },
    options,
  );
  window.addEventListener(
    'pointerup',
    () => {
      if (down) lastTap = { ...down, at: performance.now() };
      down = undefined;
    },
    options,
  );
  window.addEventListener(
    'pointercancel',
    () => {
      down = undefined;
    },
    options,
  );
}

/** What a caught tap sends: none of it may reach what's under the catcher, nor React. */
const CAUGHT_EVENTS = [
  'pointerdown',
  'pointerup',
  'touchstart',
  'touchend',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
] as const;

/**
 * Called as a sheet opens or closes: if a tap has just ended (the one that opened or
 * closed it), a second tap at its spot is caught until SECOND_TAP_MS after it. A small
 * transparent square there, in `container` (the sheet now on top, or the page), takes
 * it, so it can't act on what the first tap opened or uncovered: a stat button on the
 * live game screen, the sheet's own buttons as it slides in, a row of the log under a
 * confirmation's Cancel. Taps anywhere else go through at once, and a sheet opened or
 * closed from the keyboard gets no catcher. `className` places and sizes it (Sheet's
 * .secondTap); it's marked `data-second-tap`.
 */
export function catchSecondTap(container: Element, className: string): void {
  const tap = lastTap;
  if (!tap) return;
  let until = tap.at + SECOND_TAP_MS;
  if (performance.now() >= until) return;

  const catcher = document.createElement('div');
  catcher.className = className;
  catcher.dataset.secondTap = '';
  catcher.setAttribute('aria-hidden', 'true');
  catcher.style.setProperty('--second-tap-x', `${tap.x}px`);
  catcher.style.setProperty('--second-tap-y', `${tap.y}px`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    clearTimeout(timer);
    catcher.remove();
    catchers.delete(remove);
  };
  const removeLater = () => {
    clearTimeout(timer);
    timer = setTimeout(remove, Math.max(0, until - performance.now()));
  };
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'pointerdown') {
      // Caught: the tap after it is caught for as long again.
      until = performance.now() + SECOND_TAP_MS;
      removeLater();
    }
  };
  for (const type of CAUGHT_EVENTS) catcher.addEventListener(type, swallow, { passive: false });

  container.append(catcher);
  catchers.add(remove);
  removeLater();
}

/** Removes every catcher and forgets the last tap: for tests, so none carries into the next. */
export function stopCatchingSecondTaps(): void {
  for (const remove of [...catchers]) remove();
  down = undefined;
  lastTap = undefined;
}
