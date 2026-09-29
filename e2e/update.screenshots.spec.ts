import { expect, test, type Page } from '@playwright/test';
import { IPHONE_SAFE_BOTTOM, IPHONE_VIEWPORT, screenHeading } from './support/app';
import { bringUpdateBehindATap, updateBanner } from './support/update';
import { startVersionedServer } from './support/versionedServer';

// Screenshots of the app-update banner that waits for taps (a reload would lose one),
// on Games and under a toast on Settings, at the typical iPhone size and the smallest
// one, where its text takes three lines. Run with `npm run screenshots` (SCREENSHOT_DIR
// picks the folder).

interface Device {
  name: string;
  width: number;
  height: number;
  /** Home indicator inset; 0 on phones with a home button. */
  safeBottom: number;
}

const DEVICES: readonly Device[] = [
  { name: 'iphone', ...IPHONE_VIEWPORT, safeBottom: IPHONE_SAFE_BOTTOM },
  { name: 'se', width: 375, height: 667 - 20, safeBottom: 0 },
];

async function emulateDevice(page: Page, device: Device) {
  await page.setViewportSize({ width: device.width, height: device.height });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 0, bottom: device.safeBottom, left: 0, right: 0 },
  });
}

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`app update, ${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    for (const device of DEVICES) {
      test(`the update waits for taps (${device.name})`, async ({ page }) => {
        const server = await startVersionedServer();
        try {
          await emulateDevice(page, device);
          await bringUpdateBehindATap(page, server);
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: `${outputDir}/update-waits-${device.name}-${colorScheme}.png`,
            animations: 'disabled',
          });

          // A toast, on Settings: it keeps its gap above the banner, however tall.
          await page.getByRole('link', { name: 'Settings', exact: true }).tap();
          await expect(screenHeading(page, 'Settings')).toBeVisible();
          await expect(updateBanner(page)).toBeVisible();
          await page.getByRole('button', { name: /Save a backup file/ }).tap();
          await expect(page.getByRole('status', { name: 'Notifications' })).toContainText(
            'Backup file downloaded',
            { timeout: 10_000 },
          );
          await page.screenshot({
            path: `${outputDir}/update-waits-toast-${device.name}-${colorScheme}.png`,
            animations: 'disabled',
          });
        } finally {
          await server.close();
        }
      });
    }
  });
}
