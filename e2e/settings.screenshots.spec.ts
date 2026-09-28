import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { paths } from '../src/routes';
import { appUrl, emulateIPhoneSafeArea, expectRoute } from './support/app';
import { seedDemoData } from './support/data';

// Screenshots of the Settings screen, its sheets and the install banner, in the same
// way as e2e/screenshots.spec.ts (run with `npm run screenshots`).

const BACKUP_FIXTURE = fileURLToPath(new URL('./fixtures/settings-backup.json', import.meta.url));

/** Safari on an iPhone: the only browser that gets the "Add to Home Screen" banner. */
const IPHONE_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

interface Screen {
  /** File name stem: saved as `<name>-light.png` and `<name>-dark.png`. */
  name: string;
  path: string;
  setup?: (page: Page) => Promise<void>;
  interact?: (page: Page) => Promise<void>;
  viewportOnly?: boolean;
}

/** The demo season, plus a backup file saved yesterday on this phone. */
async function seedWithBackup(page: Page) {
  await seedDemoData(page);
  await page.evaluate(() => {
    localStorage.setItem('hoop-stats.lastBackupFileSavedAt', String(Date.now() - 86_400_000));
  });
}

function openDialog(buttonName: RegExp, role: 'dialog' | 'alertdialog', dialogName: string) {
  return async (page: Page) => {
    await page.getByRole('button', { name: buttonName }).tap();
    await expect(page.getByRole(role, { name: dialogName })).toBeVisible();
  };
}

const screens: Screen[] = [
  { name: 'settings-top', path: paths.settings, setup: seedWithBackup, viewportOnly: true },
  { name: 'settings-full', path: paths.settings, setup: seedWithBackup },
  { name: 'settings-empty', path: paths.settings },
  {
    name: 'settings-player-sheet',
    path: paths.settings,
    setup: seedWithBackup,
    viewportOnly: true,
    interact: openDialog(/^Ava/, 'dialog', 'Player'),
  },
  {
    name: 'settings-restore-sheet',
    path: paths.settings,
    setup: seedWithBackup,
    viewportOnly: true,
    interact: async (page) => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Restore from a backup file' }).tap();
      await (await chooser).setFiles(BACKUP_FIXTURE);
      await expect(page.getByRole('dialog', { name: 'Restore this backup?' })).toBeVisible();
    },
  },
  {
    name: 'settings-restore-error',
    path: paths.settings,
    viewportOnly: true,
    interact: async (page) => {
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Restore from a backup file' }).tap();
      await (
        await chooser
      ).setFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
      await expect(page.getByRole('dialog', { name: "Can't restore this file" })).toBeVisible();
    },
  },
  {
    name: 'settings-install-sheet',
    path: paths.settings,
    setup: seedWithBackup,
    viewportOnly: true,
    interact: openDialog(/^Add to Home Screen/, 'dialog', 'Add to Home Screen'),
  },
  {
    // The end of the steps: why it matters, scrolled into view.
    name: 'settings-install-sheet-end',
    path: paths.settings,
    setup: seedWithBackup,
    viewportOnly: true,
    interact: async (page) => {
      await openDialog(/^Add to Home Screen/, 'dialog', 'Add to Home Screen')(page);
      // The last thing in the sheet (Chromium here isn't an iPhone, so it gets this note).
      await page.getByText(/^Not on an iPhone\?/).scrollIntoViewIfNeeded();
    },
  },
  {
    name: 'settings-erase-confirm',
    path: paths.settings,
    setup: seedWithBackup,
    viewportOnly: true,
    interact: openDialog(/^Erase all data/, 'alertdialog', 'Erase all data?'),
  },
];

async function capture(page: Page, screen: Screen, fileName: string) {
  await emulateIPhoneSafeArea(page);
  await page.goto('./');
  await screen.setup?.(page);
  // A fresh document, so the previous screen can't be captured by mistake.
  await page.goto('about:blank');
  await page.goto(appUrl(screen.path));
  await expectRoute(page, screen.path);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await screen.interact?.(page);
  await page.screenshot({
    path: `${outputDir}/${fileName}`,
    fullPage: !screen.viewportOnly,
    animations: 'disabled',
  });
}

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    for (const screen of screens) {
      test(screen.name, async ({ page }) => {
        await capture(page, screen, `${screen.name}-${colorScheme}.png`);
      });
    }

    test.describe('in iPhone Safari', () => {
      test.use({ userAgent: IPHONE_SAFARI_UA });

      test('games-install-banner', async ({ page }) => {
        const screen: Screen = {
          name: 'games-install-banner',
          path: paths.home,
          viewportOnly: true,
          interact: async (bannerPage) => {
            await expect(
              bannerPage.getByRole('complementary', { name: 'Add to Home Screen' }),
            ).toBeVisible();
          },
        };
        await capture(page, screen, `${screen.name}-${colorScheme}.png`);
      });
    });
  });
}
