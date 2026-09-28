import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import {
  appUrl,
  emulateIPhoneSafeArea,
  IPHONE_SAFE_BOTTOM,
  IPHONE_VIEWPORT,
  screenHeading,
} from './support/app';

// Real-browser checks for the shared components, using the /dev/ui gallery. Unit tests
// cover the logic; these cover what jsdom can't: <dialog>, focus, layout and CSS.

const VIEWPORT = IPHONE_VIEWPORT;
const SAFE_BOTTOM = IPHONE_SAFE_BOTTOM;
const TAB_BAR_HEIGHT = 50; // --tab-bar-height
const TOAST_GAP = 12; // --space-3

/** How long a sheet takes to animate away, plus margin, for "it stayed open" checks. */
const EXIT_ANIMATION_MS = 400;

const notifications = (page: Page) => page.getByRole('status', { name: 'Notifications' });
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.style.overflow);

test.beforeEach(async ({ page }) => {
  await emulateIPhoneSafeArea(page);
  await page.goto(appUrl(paths.devUi));
  await expect(screenHeading(page, 'UI kit')).toBeVisible();
});

test('the gallery fits the phone width', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(VIEWPORT.width);
});

test('a sheet is modal: focus moves in, the page locks, Escape closes and focus returns', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'Edit game' });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: 'Edit game' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
  expect(await pageOverflow(page)).toBe('hidden');

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(await pageOverflow(page)).toBe('');
});

test('tapping the dimmed page closes a sheet, unless it is not dismissible', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit game' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Edit game' });
  await expect(sheet).toBeVisible();
  await page.touchscreen.tap(VIEWPORT.width / 2, 40);
  await expect(sheet).toBeHidden();

  await page.getByRole('button', { name: 'Final score' }).tap();
  const locked = page.getByRole('dialog', { name: 'Final score' });
  await expect(locked).toBeVisible();
  await expect(locked.getByRole('button', { name: 'Close' })).toHaveCount(0);
  // With no close button, focus starts on the title rather than popping up the keyboard.
  await expect(locked.getByRole('heading', { name: 'Final score' })).toBeFocused();
  await page.touchscreen.tap(VIEWPORT.width / 2, 40);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(EXIT_ANIMATION_MS);
  await expect(locked).toBeVisible();

  await locked.getByRole('button', { name: 'Keep playing' }).tap();
  await expect(locked).toBeHidden();
});

test('a tall sheet scrolls its content and keeps its header', async ({ page }) => {
  await page.getByRole('button', { name: 'Pick opponent' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Pick opponent' });
  await expect(sheet).toBeVisible();

  const last = sheet.getByRole('button', { name: 'Wolves' });
  await expect(last).not.toBeInViewport();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(sheet.getByRole('heading', { name: 'Pick opponent' })).toBeInViewport();

  await last.tap();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('link', { name: /vs Wolves/ })).toBeVisible();
});

test('useConfirm resolves with the answer and starts on Cancel for a destructive action', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Delete game', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Delete this game?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await dialog.getByRole('button', { name: 'Delete game' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Last answer: deleted')).toBeVisible();
  await expect(notifications(page)).toHaveText('Game deleted');
});

test('a toast floats above the home indicator, lets taps through and runs its action', async ({
  page,
}) => {
  await page.getByRole('button', { name: '2PT made' }).tap();
  const toast = notifications(page);
  const message = toast.getByText('2PT made');
  await expect(message).toBeVisible();

  // The strip holding the toast (the toast itself slides in, so measure its container).
  const box = await toast.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(
    VIEWPORT.height - SAFE_BOTTOM - TOAST_GAP,
    0,
  );
  // Only the action takes taps; the rest of the toast never blocks what's under it.
  await expect(message).toHaveCSS('pointer-events', 'none');

  await toast.getByRole('button', { name: 'Undo' }).tap();
  await expect(toast).toHaveText('Undone: 2PT made');
});

test('toasts stay clear of the tab bar on tab screens', async ({ page }) => {
  const toastBottom = () => notifications(page).evaluate((el) => getComputedStyle(el).bottom);
  expect(await toastBottom()).toBe(`${SAFE_BOTTOM + TOAST_GAP}px`);

  await page.goto(appUrl(paths.home));
  await expect(screenHeading(page, 'Games')).toBeVisible();
  expect(await toastBottom()).toBe(`${TAB_BAR_HEIGHT + SAFE_BOTTOM + TOAST_GAP}px`);
});

test('a wide stat table scrolls under its sticky first column; a narrow one fits', async ({
  page,
}) => {
  const wide = page.getByRole('region', { name: 'Box score by quarter' });
  await wide.scrollIntoViewIfNeeded();
  const rowHeader = wide.getByRole('rowheader', { name: 'Q1' });
  const points = wide.getByRole('columnheader', { name: 'Points' });
  const before = { rowHeader: await rowHeader.boundingBox(), points: await points.boundingBox() };

  await wide.evaluate((scroller) => scroller.scrollBy({ left: 150 }));
  await expect(wide).toHaveClass(/scrolledStart/);
  const after = { rowHeader: await rowHeader.boundingBox(), points: await points.boundingBox() };
  expect(after.rowHeader?.x).toBe(before.rowHeader?.x);
  expect(after.points?.x).toBeLessThan((before.points?.x ?? 0) - 100);

  const narrow = page.getByRole('region', { name: 'Game log' });
  expect(await narrow.evaluate((scroller) => scroller.scrollWidth <= scroller.clientWidth)).toBe(
    true,
  );
  await expect(narrow).not.toHaveAttribute('tabindex');
});

test('shareText copies the text when there is no share sheet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const canShare = await page.evaluate(() => typeof navigator.share === 'function');
  test.skip(canShare, 'This browser has a share sheet, so nothing is copied.');

  await page.getByRole('button', { name: 'Share summary' }).tap();
  await expect(notifications(page)).toHaveText('Copied to clipboard');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '14 PTS · 7 REB · 3 AST',
  );
});
