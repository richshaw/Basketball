import { expect, test, type Browser, type Page } from '@playwright/test';
import { generateBackupCode } from '../src/data/backup/code';
import { paths } from '../src/routes';
import type { FakeBackupServer } from '../src/test/fakeBackupServer';
import { appUrl, emulateIPhoneSafeArea, expectRoute } from './support/app';
import {
  backUpFromAnotherPhone,
  backUpNow,
  disableCloudBackup,
  E2E_BACKUP_API_URL,
  enableCloudBackup,
  getBackupCode,
  getBackupStatus,
  routeFakeBackupServer,
} from './support/backup';
import { clearAllData } from './support/data';
import { seedOwnGames } from './support/ownGames';

// Screenshots of cloud backup: the Settings section in each state, the code sheet, the
// restore screen, the erase question and the Games banner, like e2e/screenshots.spec.ts
// (run with `npm run screenshots`).

// page.route can't see requests a service worker handles, and the worker isn't under test.
test.use({ serviceWorkers: 'block' });

type Setup = (page: Page, server: FakeBackupServer) => Promise<void>;

interface Shot {
  /** File name stem: saved as `<name>-light.png` and `<name>-dark.png`. */
  name: string;
  path: string;
  setup?: Setup;
  interact?: (page: Page) => Promise<void>;
}

const CLOUD_BACKUP = paths.settingsSection('cloud-backup');

async function waitForState(page: Page, state: string) {
  await expect.poll(async () => (await getBackupStatus(page)).state).toBe(state);
}

/** The parent's own ten games, backed up. */
const backedUp: Setup = async (page, server) => {
  await seedOwnGames(page);
  await enableCloudBackup(page);
  await expect.poll(() => server.uploads.length).toBe(1);
  await waitForState(page, 'idle');
};

/** Tap a button and wait for the dialog it opens. */
function openDialog(button: string | RegExp, role: 'dialog' | 'alertdialog', name: string) {
  return async (page: Page) => {
    await page.getByRole('button', { name: button }).tap();
    await expect(page.getByRole(role, { name })).toBeVisible();
  };
}

const shots: Shot[] = [
  { name: 'backup-off', path: CLOUD_BACKUP },
  {
    name: 'backup-off-code-kept',
    path: CLOUD_BACKUP,
    setup: async (page, server) => {
      await backedUp(page, server);
      await disableCloudBackup(page);
    },
  },
  {
    name: 'backup-code-sheet',
    path: CLOUD_BACKUP,
    setup: (page) => seedOwnGames(page),
    interact: openDialog('Turn on cloud backup', 'dialog', 'Save your backup code'),
  },
  { name: 'backup-on', path: CLOUD_BACKUP, setup: backedUp },
  {
    name: 'backup-turn-off-sheet',
    path: CLOUD_BACKUP,
    setup: backedUp,
    interact: openDialog('Turn off', 'dialog', 'Turn off cloud backup?'),
  },
  {
    name: 'backup-waiting-for-signal',
    path: CLOUD_BACKUP,
    setup: async (page, server) => {
      await backedUp(page, server);
      // No answer from the server, like a gym without signal (routes added later win).
      await page.route(`${E2E_BACKUP_API_URL}/**`, (route) => route.abort('internetdisconnected'));
      await backUpNow(page);
      await waitForState(page, 'waiting-for-signal');
    },
  },
  {
    name: 'backup-error',
    path: CLOUD_BACKUP,
    setup: async (page, server) => {
      await backedUp(page, server);
      server.failNext({ status: 503, error: 'server_busy', retryAfterSeconds: 300, method: 'PUT' });
      await backUpNow(page);
      await waitForState(page, 'error');
    },
  },
  {
    name: 'backup-paused-shrink',
    path: CLOUD_BACKUP,
    setup: async (page, server) => {
      await backedUp(page, server);
      await clearAllData(page);
      await backUpNow(page);
      await waitForState(page, 'paused-shrink');
    },
  },
  {
    name: 'backup-paused-other-device',
    path: CLOUD_BACKUP,
    setup: async (page, server) => {
      await backedUp(page, server);
      backUpFromAnotherPhone(server);
      await backUpNow(page);
      await waitForState(page, 'paused-other-device');
    },
  },
  {
    name: 'backup-needs-attention',
    path: CLOUD_BACKUP,
    setup: async (page, server) => {
      await backedUp(page, server);
      server.failNext({ status: 409, error: 'account_deleted', method: 'PUT' });
      await backUpNow(page);
      await waitForState(page, 'needs-attention');
    },
  },
  {
    name: 'backup-erase-confirm',
    path: paths.settings,
    setup: backedUp,
    interact: openDialog(/^Erase all data/, 'alertdialog', 'Erase all data?'),
  },
  {
    name: 'backup-games-banner',
    path: paths.home,
    setup: async (page, server) => {
      await backedUp(page, server);
      backUpFromAnotherPhone(server);
      await backUpNow(page);
      await waitForState(page, 'paused-other-device');
    },
    interact: (page) =>
      expect(page.getByRole('link', { name: 'Cloud backup is paused. Tap to fix' })).toBeVisible(),
  },
  {
    name: 'backup-restore-typo',
    path: paths.restoreBackup('games'),
    interact: async (page) => {
      const code = generateBackupCode();
      const typo = `${code.slice(0, 5)}${code[5] === '0' ? '1' : '0'}${code.slice(6)}`;
      await page.getByLabel('Backup code').fill(typo);
      await page.getByRole('button', { name: 'Find backup' }).tap();
      await expect(page.getByLabel('Backup code')).toHaveAttribute('aria-invalid', 'true');
      // The keyboard would be open: leave the field so the capture shows the page as is.
      await page.getByLabel('Backup code').blur();
    },
  },
];

async function capture(page: Page, shot: Shot, server: FakeBackupServer, fileName: string) {
  await emulateIPhoneSafeArea(page);
  await page.goto('./');
  await shot.setup?.(page, server);
  // A fresh document, so the previous screen can't be captured by mistake.
  await page.goto('about:blank');
  await page.goto(appUrl(shot.path));
  await expectRoute(page, shot.path);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await shot.interact?.(page);
  await page.screenshot({ path: `${outputDir}/${fileName}`, animations: 'disabled' });
}

/** Another phone (its own browser context) that has backed up its games; resolves to its code. */
async function backUpOnAnotherPhone(
  browser: Browser,
  baseURL: string | undefined,
  server: FakeBackupServer,
): Promise<string> {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await routeFakeBackupServer(page, server);
    await page.goto('./');
    await backedUp(page, server);
    const code = await getBackupCode(page);
    if (!code) throw new Error('The other phone has no backup code');
    return code;
  } finally {
    await context.close();
  }
}

const outputDir = process.env.SCREENSHOT_DIR || 'screenshots';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} mode`, { tag: '@screenshots' }, () => {
    test.use({ colorScheme });

    for (const shot of shots) {
      test(shot.name, async ({ page }) => {
        const server = await routeFakeBackupServer(page);
        await capture(page, shot, server, `${shot.name}-${colorScheme}.png`);
      });
    }

    // A new phone restoring the backup another phone made.
    test('backup-restore-preview', async ({ page, browser, baseURL }) => {
      const server = await routeFakeBackupServer(page);
      const code = await backUpOnAnotherPhone(browser, baseURL, server);
      const shot: Shot = {
        name: 'backup-restore-preview',
        path: paths.restoreBackup('games'),
        interact: async (newPhone) => {
          await newPhone.getByLabel('Backup code').fill(code);
          await newPhone.getByRole('button', { name: 'Find backup' }).tap();
          await expect(
            newPhone.getByRole('dialog', { name: 'Restore this backup?' }),
          ).toContainText('10 games');
        },
      };
      await capture(page, shot, server, `${shot.name}-${colorScheme}.png`);
    });
  });
}
