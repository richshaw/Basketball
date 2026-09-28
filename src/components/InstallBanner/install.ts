/**
 * Is Hoop Stats running as a Home Screen app, and should we suggest adding it?
 *
 * A Home Screen app works offline and keeps its data (Safari may clear a website's
 * data after a while), so the app nudges iPhone Safari users to add it. Detection is
 * deliberately cautious: desktop and Android browsers (and the Playwright tests) never
 * see the banner.
 */

type NavigatorInfo = Pick<Navigator, 'userAgent'> & {
  /** Missing in some browsers (and jsdom). */
  maxTouchPoints?: number;
  /** Safari's own "running from the Home Screen" flag. */
  standalone?: boolean;
};

type WindowInfo = Pick<Window, 'navigator'> & {
  matchMedia?: (query: string) => Pick<MediaQueryList, 'matches'>;
};

/** Running from the Home Screen (an installed web app), not in a browser tab. */
export function isStandalone(win: WindowInfo = window): boolean {
  if ((win.navigator as NavigatorInfo).standalone === true) return true;
  try {
    return (
      typeof win.matchMedia === 'function' && win.matchMedia('(display-mode: standalone)').matches
    );
  } catch {
    return false;
  }
}

/** An iPhone, iPod touch or iPad, including iPads whose Safari says it's a Mac. */
export function isIosDevice(nav: NavigatorInfo = navigator): boolean {
  const ua = nav.userAgent;
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  // iPadOS asks for desktop sites as a Mac; real Macs have no touch screen.
  return /\bMacintosh\b/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

/** Other iOS browsers and in-app browsers, whose menus differ from Safari's steps. */
const NOT_SAFARI = /\b(CriOS|FxiOS|EdgiOS|OPiOS|OPT|GSA|FBAN|FBAV|Instagram|Line)\b/;

/** Safari on an iPhone or iPad: where "Share > Add to Home Screen" is how to install. */
export function isIosSafari(nav: NavigatorInfo = navigator): boolean {
  return isIosDevice(nav) && /\bSafari\//.test(nav.userAgent) && !NOT_SAFARI.test(nav.userAgent);
}

// When the banner was last dismissed. A per-device preference, so it lives in
// localStorage; it may be missing (e.g. in a private window), which just shows it again.
const DISMISSED_KEY = 'hoop-stats.installBannerDismissedAt';

/** A dismissed banner stays away this long. */
export const INSTALL_BANNER_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

export function rememberInstallBannerDismissed(now: number = Date.now()): void {
  try {
    localStorage.setItem(DISMISSED_KEY, String(now));
  } catch {
    // Storage full or blocked: the banner just comes back next time.
  }
}

/** Dismissed less than 14 days ago (a clock that jumped back counts as "not recently"). */
export function isInstallBannerSnoozed(now: number = Date.now()): boolean {
  let dismissedAt: number;
  try {
    dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) ?? Number.NaN);
  } catch {
    return false;
  }
  if (!Number.isFinite(dismissedAt)) return false;
  const elapsed = now - dismissedAt;
  return elapsed >= 0 && elapsed < INSTALL_BANNER_SNOOZE_MS;
}

/** Show the "Add to Home Screen" banner: iPhone Safari, not installed, not dismissed lately. */
export function shouldShowInstallBanner(
  win: WindowInfo = window,
  now: number = Date.now(),
): boolean {
  return isIosSafari(win.navigator) && !isStandalone(win) && !isInstallBannerSnoozed(now);
}
