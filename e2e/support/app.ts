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
 * Emulates an iPhone with a Dynamic Island (e.g. iPhone 15): content drawn under the
 * status bar and home indicator must be padded by the safe-area insets.
 */
export async function emulateIPhoneSafeArea(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  });
}
