import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INSTALL_BANNER_SNOOZE_MS,
  isInstallBannerSnoozed,
  isIosDevice,
  isIosSafari,
  isStandalone,
  rememberInstallBannerDismissed,
  shouldShowInstallBanner,
} from './install';
import { DESKTOP_CHROME_UA, IPHONE_SAFARI_UA } from '@/test/browser';

const IPAD_SAFARI_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
/** iPadOS Safari asks for desktop sites, so it says it's a Mac. */
const IPAD_DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_SAFARI_UA = IPAD_DESKTOP_UA;
const IPHONE_CHROME_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1';
const IPHONE_FACEBOOK_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0.0.1;FBBV/1]';
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const JSDOM_UA = navigator.userAgent;

/** A window with just the parts detection looks at. */
function fakeWindow({
  userAgent = IPHONE_SAFARI_UA,
  maxTouchPoints = 5,
  standalone,
  displayModeStandalone = false,
}: {
  userAgent?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  displayModeStandalone?: boolean;
} = {}) {
  return {
    navigator: { userAgent, maxTouchPoints, standalone } as unknown as Navigator,
    matchMedia: (query: string) => ({
      matches: displayModeStandalone && query === '(display-mode: standalone)',
    }),
  };
}

const NOW = new Date(2026, 8, 28, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

afterEach(() => {
  localStorage.clear();
});

describe('isIosDevice', () => {
  it.each([
    ['iPhone Safari', IPHONE_SAFARI_UA, 5],
    ['iPad Safari', IPAD_SAFARI_UA, 5],
    ['iPad Safari asking for the desktop site', IPAD_DESKTOP_UA, 5],
    ['iPhone Chrome', IPHONE_CHROME_UA, 5],
  ])('recognizes %s', (_, userAgent, maxTouchPoints) => {
    expect(isIosDevice({ userAgent, maxTouchPoints })).toBe(true);
  });

  it.each([
    ['a Mac', MAC_SAFARI_UA, 0],
    ['desktop Chrome', DESKTOP_CHROME_UA, 0],
    ['Android', ANDROID_CHROME_UA, 5],
    ['jsdom (no maxTouchPoints)', JSDOM_UA, undefined],
  ])('rejects %s', (_, userAgent, maxTouchPoints) => {
    expect(isIosDevice({ userAgent, maxTouchPoints })).toBe(false);
  });
});

describe('isIosSafari', () => {
  it('is Safari on an iPhone or iPad', () => {
    expect(isIosSafari({ userAgent: IPHONE_SAFARI_UA })).toBe(true);
    expect(isIosSafari({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 })).toBe(true);
  });

  it('is not another browser or an in-app browser on iOS, nor Safari on a Mac', () => {
    expect(isIosSafari({ userAgent: IPHONE_CHROME_UA })).toBe(false);
    expect(isIosSafari({ userAgent: IPHONE_FACEBOOK_UA })).toBe(false);
    expect(isIosSafari({ userAgent: MAC_SAFARI_UA, maxTouchPoints: 0 })).toBe(false);
    expect(isIosSafari({ userAgent: ANDROID_CHROME_UA, maxTouchPoints: 5 })).toBe(false);
  });
});

describe('isStandalone', () => {
  it("is true for Safari's Home Screen flag", () => {
    expect(isStandalone(fakeWindow({ standalone: true }))).toBe(true);
  });

  it('is true in standalone display mode', () => {
    expect(isStandalone(fakeWindow({ displayModeStandalone: true }))).toBe(true);
  });

  it('is false in a browser tab', () => {
    expect(isStandalone(fakeWindow({ standalone: false }))).toBe(false);
    expect(isStandalone(fakeWindow())).toBe(false);
  });

  it('is false where matchMedia is missing or broken', () => {
    expect(isStandalone({ navigator: { userAgent: JSDOM_UA } as Navigator })).toBe(false);
    expect(
      isStandalone({
        navigator: { userAgent: JSDOM_UA } as Navigator,
        matchMedia: () => {
          throw new Error('Nope');
        },
      }),
    ).toBe(false);
  });

  it('is false in this test browser', () => {
    expect(isStandalone()).toBe(false);
  });
});

describe('dismissing the banner', () => {
  it('snoozes it for 14 days', () => {
    expect(isInstallBannerSnoozed(NOW)).toBe(false);
    rememberInstallBannerDismissed(NOW);
    expect(isInstallBannerSnoozed(NOW)).toBe(true);
    expect(isInstallBannerSnoozed(NOW + 13 * DAY)).toBe(true);
    expect(isInstallBannerSnoozed(NOW + INSTALL_BANNER_SNOOZE_MS)).toBe(false);
    expect(INSTALL_BANNER_SNOOZE_MS).toBe(14 * DAY);
  });

  it('does not stay snoozed forever if the clock was set back', () => {
    rememberInstallBannerDismissed(NOW);
    expect(isInstallBannerSnoozed(NOW - DAY)).toBe(false);
  });

  it('ignores a damaged value', () => {
    localStorage.setItem('hoop-stats.installBannerDismissedAt', 'soon');
    expect(isInstallBannerSnoozed(NOW)).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(() => rememberInstallBannerDismissed(NOW)).not.toThrow();
    expect(isInstallBannerSnoozed(NOW)).toBe(false);
  });
});

describe('shouldShowInstallBanner', () => {
  it('shows in iPhone Safari', () => {
    expect(shouldShowInstallBanner(fakeWindow(), NOW)).toBe(true);
  });

  it('never shows in the Home Screen app', () => {
    expect(shouldShowInstallBanner(fakeWindow({ standalone: true }), NOW)).toBe(false);
    expect(shouldShowInstallBanner(fakeWindow({ displayModeStandalone: true }), NOW)).toBe(false);
  });

  it('never shows on desktop or Android browsers', () => {
    expect(
      shouldShowInstallBanner(fakeWindow({ userAgent: DESKTOP_CHROME_UA, maxTouchPoints: 0 }), NOW),
    ).toBe(false);
    expect(shouldShowInstallBanner(fakeWindow({ userAgent: ANDROID_CHROME_UA }), NOW)).toBe(false);
    expect(shouldShowInstallBanner(window, NOW)).toBe(false);
  });

  it('stays away for 14 days after it is dismissed', () => {
    rememberInstallBannerDismissed(NOW);
    expect(shouldShowInstallBanner(fakeWindow(), NOW + DAY)).toBe(false);
    expect(shouldShowInstallBanner(fakeWindow(), NOW + 15 * DAY)).toBe(true);
  });
});
