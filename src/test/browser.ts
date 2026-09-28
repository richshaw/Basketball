/**
 * Test helpers for browser features jsdom doesn't have (the share sheet, Home Screen
 * mode, an iPhone user agent). Only tests import this.
 */
import { vi } from 'vitest';

const restores: (() => void)[] = [];

/**
 * Gives `target` these own properties until `restoreStubs()` runs (call it in
 * afterEach). Own properties shadow the prototype's, e.g. `navigator.userAgent`.
 */
export function stubProperties(target: object, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
    restores.push(() => {
      if (previous) Object.defineProperty(target, key, previous);
      else Reflect.deleteProperty(target, key);
    });
  }
}

/** Undoes every `stubProperties` call, newest first. */
export function restoreStubs(): void {
  for (let restore = restores.pop(); restore; restore = restores.pop()) restore();
}

export const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
export const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export interface SimulatedBrowser {
  userAgent?: string;
  maxTouchPoints?: number;
  /** Safari's own flag for a Home Screen app (`navigator.standalone`). */
  navigatorStandalone?: boolean;
  /** Whether `(display-mode: standalone)` matches. */
  displayModeStandalone?: boolean;
}

/** Makes jsdom look like the given browser, until `restoreStubs()`. */
export function simulateBrowser({
  userAgent = IPHONE_SAFARI_UA,
  maxTouchPoints = 5,
  navigatorStandalone,
  displayModeStandalone = false,
}: SimulatedBrowser = {}): void {
  stubProperties(navigator, { userAgent, maxTouchPoints });
  if (navigatorStandalone !== undefined) {
    stubProperties(navigator, { standalone: navigatorStandalone });
  }
  stubProperties(window, {
    matchMedia: vi.fn((query: string) => ({
      matches: displayModeStandalone && query.includes('standalone'),
      media: query,
    })),
  });
}
