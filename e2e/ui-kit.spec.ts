import { expect, test, type Locator, type Page } from '@playwright/test';
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

interface Point {
  x: number;
  y: number;
}

async function centerOf(locator: Locator): Promise<Point> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Element is not on screen');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** What a tap at this point would hit: the toast's action, the rest of the toast, or the page. */
function hitTest(page: Page, point: Point) {
  return page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y);
    if (!target?.closest('[role="status"]')) return 'page';
    return target.closest('button') ? 'toast action' : 'toast';
  }, point);
}

/** Two quick taps on the same spot, like an impatient thumb. */
async function doubleTap(page: Page, point: Point) {
  await page.touchscreen.tap(point.x, point.y);
  await page.touchscreen.tap(point.x, point.y);
}

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

test('closing a dialog inside a sheet leaves the sheet and what was typed', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit game' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Edit game' });
  const opponent = sheet.getByRole('combobox', { name: 'Opponent' });
  await opponent.fill('Hawks');

  for (const dismiss of ['Escape', 'Cancel'] as const) {
    await sheet.getByRole('button', { name: 'Delete…' }).tap();
    const confirm = page.getByRole('alertdialog', { name: 'Delete this game?' });
    await expect(confirm).toBeVisible();
    if (dismiss === 'Escape') await page.keyboard.press('Escape');
    else await confirm.getByRole('button', { name: 'Cancel' }).tap();
    await expect(confirm).toBeHidden();

    await page.waitForTimeout(EXIT_ANIMATION_MS);
    await expect(sheet).toBeVisible();
    await expect(opponent).toHaveValue('Hawks');
  }
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

test('useConfirm: a double tap that answers one question cannot answer the next', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Archive season' }).tap();
  const first = page.getByRole('alertdialog', { name: 'Archive this season?' });
  await expect(first).toBeVisible();

  // The next question's red confirm button opens right where "Archive" was.
  await doubleTap(page, await centerOf(first.getByRole('button', { name: 'Archive' })));
  const second = page.getByRole('alertdialog', { name: 'Delete its practice games too?' });
  await expect(second).toBeVisible();
  await expect(second.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(page.getByText('Last answer: none yet')).toBeVisible();

  await second.getByRole('button', { name: 'Cancel' }).tap();
  await expect(page.getByText('Last answer: archived, kept practices')).toBeVisible();
});

test('a toast floats above the home indicator and only its action takes taps', async ({ page }) => {
  await page.getByRole('button', { name: '2PT made' }).tap();
  const toast = notifications(page);
  const message = toast.getByText('2PT made', { exact: true });
  await expect(message).toBeVisible();

  // The strip holding the toast (the toast itself slides in, so measure its container).
  const box = await toast.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(
    VIEWPORT.height - SAFE_BOTTOM - TOAST_GAP,
    0,
  );
  // A tap on the message reaches the page underneath; a tap on the action doesn't.
  expect(await hitTest(page, await centerOf(message))).toBe('page');
  expect(await hitTest(page, await centerOf(toast.getByRole('button', { name: 'Undo' })))).toBe(
    'toast action',
  );
});

test("a double tap on a toast's action runs it once and can't reach the page", async ({ page }) => {
  await page.getByRole('button', { name: '2PT made' }).tap();
  const toast = notifications(page);
  const undo = toast.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeVisible();
  const spot = await centerOf(undo);

  await doubleTap(page, spot);
  // The toast stays a moment after its action, catching the second tap.
  expect(await hitTest(page, spot)).toBe('toast action');
  await expect(page.getByText('Undos: 1')).toBeVisible();
  await expect(toast).toHaveText('Undone: 2PT made');
  await expect(page.getByText('Undos: 1')).toBeVisible();
});

test('a toast in a tall sheet takes its own room under the header, covering nothing', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Pick opponent' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Pick opponent' });
  await expect(sheet).toBeVisible();
  const copy = sheet.getByRole('button', { name: 'Copy list' });

  await copy.tap();
  const toast = sheet.getByRole('status', { name: 'Notifications' });
  await expect(toast).toContainText('Copied 24 teams');
  const toastBox = await toast.boundingBox();
  const toastTop = toastBox?.y ?? 0;
  const toastBottom = toastTop + (toastBox?.height ?? 0);
  for (const headerPart of [
    sheet.getByRole('heading', { name: 'Pick opponent' }),
    sheet.getByRole('button', { name: 'Close' }),
  ]) {
    const box = await headerPart.boundingBox();
    expect(toastTop).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));
  }
  // The content makes room for it: the toast covers none of it.
  expect((await copy.boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(toastBottom);
  expect(await hitTest(page, await centerOf(copy))).toBe('page');
});

test('a toast shown before a sheet opens goes, instead of covering it', async ({ page }) => {
  await page.getByRole('button', { name: 'Long toast' }).tap();
  await expect(notifications(page)).toContainText('Saved.');

  await page.getByRole('button', { name: 'Pick opponent' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Pick opponent' });
  await expect(sheet).toBeVisible();
  await expect(notifications(page)).toBeEmpty();
  await sheet.getByRole('button', { name: 'Close' }).tap();
  await expect(sheet).toBeHidden();
  await expect(notifications(page)).toBeEmpty();
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
