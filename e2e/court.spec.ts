import { expect, test, type Locator, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, screenHeading } from './support/app';

// The CourtPicker in the /dev/ui gallery, in a real browser: taps land on the right
// spot at any size, the spot is labeled 2PT or 3PT, and tapping never zooms the page
// or takes focus. Unit tests cover the math with a faked screen transform.

// How the court is drawn (src/components/Court/courtGeometry.ts; e2e code can't import
// it): 10 SVG units per foot, from the left end of the baseline. Court feet have the
// basket at (0, 0), the sidelines at x = ±25 and the baseline at y = -5.25.
const UNITS_PER_FOOT = 10;
const SIDELINE_X = 25;
const BASELINE_Y = -5.25;

interface CourtPoint {
  x: number;
  y: number;
}

function courtPicker(page: Page) {
  return page.getByRole('img', { name: /^Shot location/ });
}

/**
 * Where a court point is on screen, worked out from the court's box and view box
 * (independently of the screen transform the component itself uses).
 */
async function screenPoint(court: Locator, point: CourtPoint) {
  const box = await court.boundingBox();
  if (!box) throw new Error('The court is not on screen');
  const viewBox = await court.evaluate((svg) => {
    const { x, y, width, height } = (svg as SVGSVGElement).viewBox.baseVal;
    return { x, y, width, height };
  });
  const scale = box.width / viewBox.width;
  // The court keeps its proportions: the box has the view box's aspect ratio.
  expect(box.height / scale).toBeCloseTo(viewBox.height, 0);
  return {
    x: box.x + ((point.x + SIDELINE_X) * UNITS_PER_FOOT - viewBox.x) * scale,
    y: box.y + ((point.y - BASELINE_Y) * UNITS_PER_FOOT - viewBox.y) * scale,
  };
}

async function tapCourt(page: Page, point: CourtPoint) {
  const court = courtPicker(page);
  await court.scrollIntoViewIfNeeded();
  const { x, y } = await screenPoint(court, point);
  await page.touchscreen.tap(x, y);
}

const spots = [
  { name: 'near the rim', point: { x: 1, y: 1.5 }, value: '2PT', feet: 2 },
  { name: 'in the right corner, beyond the line', point: { x: 23, y: -3 }, value: '3PT', feet: 23 },
  { name: 'at the top of the key, beyond the arc', point: { x: 0, y: 23 }, value: '3PT', feet: 23 },
  { name: 'at the left elbow', point: { x: -6, y: 13.75 }, value: '2PT', feet: 15 },
  {
    name: 'in the left corner, inside the line',
    point: { x: -18.5, y: -3 },
    value: '2PT',
    feet: 19,
  },
] as const;

test.beforeEach(async ({ page }) => {
  await emulateIPhoneSafeArea(page);
  await page.goto(appUrl(paths.devUi));
  await expect(screenHeading(page, 'UI kit')).toBeVisible();
});

test('tapping the court picks the spot and labels it 2PT or 3PT', async ({ page }) => {
  const court = courtPicker(page);
  for (const { name, point, value, feet } of spots) {
    await test.step(name, async () => {
      await tapCourt(page, point);
      await expect(court.getByText(value, { exact: true })).toBeVisible();
      await expect(page.getByText(`Picked: ${value} from ${feet} ft`)).toBeVisible();
    });
  }

  await page.getByRole('button', { name: 'Clear spot' }).tap();
  await expect(page.getByText('Nothing picked')).toBeVisible();
  await expect(court.getByText(/^[23]PT$/)).toHaveCount(0);
  await expect(court).toHaveAccessibleName(/Tap where the shot was taken/);
});

test('taps land on the right spot at other sizes too', async ({ page }) => {
  for (const width of [320, 768]) {
    await test.step(`${width}px wide`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await tapCourt(page, { x: 23, y: -3 });
      await expect(page.getByText('Picked: 3PT from 23 ft')).toBeVisible();
      await tapCourt(page, { x: -4, y: 9 });
      await expect(page.getByText('Picked: 2PT from 10 ft')).toBeVisible();
    });
  }
});

test('the label stays on the court next to the sideline', async ({ page }) => {
  const court = courtPicker(page);
  await tapCourt(page, { x: 24.5, y: 12 });
  const label = court.getByText('3PT', { exact: true });
  await expect(label).toBeVisible();

  const courtBox = await court.boundingBox();
  const labelBox = await label.boundingBox();
  const spot = await screenPoint(court, { x: 24.5, y: 12 });
  expect(courtBox && labelBox).toBeTruthy();
  if (!courtBox || !labelBox) return;
  // It moves to the left of the spot rather than off the edge.
  expect(labelBox.x + labelBox.width).toBeLessThan(spot.x);
  expect(labelBox.x).toBeGreaterThan(courtBox.x);
});

test('tapping the court never takes focus, and quick taps each pick a spot', async ({ page }) => {
  const court = courtPicker(page);
  // No double-tap zoom (iOS Safari), and a long press never selects or opens a callout.
  await expect(court).toHaveCSS('touch-action', 'manipulation');
  await expect(court).toHaveCSS('user-select', 'none');

  const clear = page.getByRole('button', { name: 'Clear spot' });
  await clear.focus();
  await tapCourt(page, { x: 0, y: 10 });
  await expect(page.getByText('Picked: 2PT from 10 ft')).toBeVisible();
  await expect(clear).toBeFocused();

  // A quick second tap moves the spot: it isn't swallowed as a double tap.
  await tapCourt(page, { x: 10, y: 20 });
  await tapCourt(page, { x: -10, y: 5 });
  await expect(page.getByText('Picked: 2PT from 11 ft')).toBeVisible();
});
