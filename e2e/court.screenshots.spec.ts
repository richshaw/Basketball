import { expect, test } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, screenHeading } from './support/app';

// PNGs of the shot chart components: the Court section of the /dev/ui gallery (a
// season ShotMap, the zone tiles and a CourtPicker with a picked spot). Saved next to
// the screens from screenshots.spec.ts by `npm run screenshots`.

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';
/** Page around the section in the picture (--space-4, the gallery's side padding). */
const MARGIN = 16;

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    test('court components', async ({ page }) => {
      await emulateIPhoneSafeArea(page);
      await page.goto(appUrl(paths.devUi));
      await expect(screenHeading(page, 'UI kit')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const section = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { level: 2, name: 'Court' }) });
      await expect(section.getByRole('img', { name: /^Shot location/ })).toBeVisible();

      // Clip the section out of a full-page capture: it's taller than the screen, and an
      // element capture would scroll it under the sticky header.
      const box = await section.evaluate((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x: x + window.scrollX, y: y + window.scrollY, width, height };
      });
      await page.screenshot({
        path: `${outputDir}/court-${colorScheme}.png`,
        fullPage: true,
        animations: 'disabled',
        clip: {
          x: box.x - MARGIN,
          y: box.y - MARGIN,
          width: box.width + 2 * MARGIN,
          height: box.height + 2 * MARGIN,
        },
      });
    });
  });
}
