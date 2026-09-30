import { expect, type Locator, type Page } from '@playwright/test';

/** Safari on an iPhone: the only browser that gets the "Add to Home Screen" banner. */
export const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

/** Relative URL of an app route (hash routing), e.g. `appUrl(paths.stats)` -> `./#/stats`. */
export function appUrl(path: string): string {
  return `./#${path}`;
}

export function screenHeading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name });
}

export function tabBar(page: Page) {
  return page.getByRole('navigation', { name: 'Main' });
}

/**
 * The spots catching a double tap's second tap, where a sheet opened or closed (see
 * src/components/Sheet/secondTap.ts): wait for none before a tap, or a look at what's
 * on top, meant for that spot.
 */
export function secondTapCatchers(page: Page): Locator {
  return page.locator('[data-second-tap]');
}

/** Waits until the app's route (the part after `#`) is `path`. */
export async function expectRoute(page: Page, path: string) {
  await expect(page).toHaveURL((url) => url.hash === `#${path}`);
}

/**
 * Emulates the home-screen app on a 6.1" iPhone: the black status bar (47pt) sits above
 * the page, so the viewport is 390x797 with no top inset, and the home indicator
 * overlaps the bottom of the page (34pt inset).
 */
export const IPHONE_VIEWPORT = { width: 390, height: 844 - 47 };
export const IPHONE_SAFE_BOTTOM = 34;

export async function emulateIPhoneSafeArea(page: Page) {
  await page.setViewportSize(IPHONE_VIEWPORT);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 0, bottom: IPHONE_SAFE_BOTTOM, left: 0, right: 0 },
  });
}
