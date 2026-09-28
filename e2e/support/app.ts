import { expect, type Page } from '@playwright/test';

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
