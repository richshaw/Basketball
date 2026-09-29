import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreStubs, stubProperties } from '@/test/browser';
import {
  backUpNow,
  disableCloudBackup,
  fetchCloudBackup,
  getBackupCode,
  getCloudBackupStatus,
  whenBackupIdle,
} from '@/data/backup/cloudBackup';
import { createBackupApi } from '@/data/backup/api';
import { parseBackupCode } from '@/data/backup/code';
import { errorMessage } from '@/data/backup/errors';
import { deriveBackupKeys } from '@/data/backup/keys';
import { createGame, listGames } from '@/data/repo';
import { paths } from '@/routes';
import { buildRealData, REAL_LIVE_GAME_ID, TEST_API_URL } from '@/test/backupHarness';
import {
  backUpFromAnotherPhone,
  pauseForAnotherPhone,
  pauseForMissingGames,
  seedOwnGames,
  settledStatus,
  setUpFakeCloudBackup,
  stopForDeletedCloudCopy,
  turnOnCloudBackup,
} from '@/test/cloudBackupApp';
import { renderRoute } from '@/test/render';
import { formatDayWithYear } from './backupFiles';
import { formatWhen } from './cloudBackupText';
import { captureDownloads } from './testUtils';

const cloud = setUpFakeCloudBackup();

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

/** Waits for a toast. (Re-queried: the toast area moves into a sheet while one is open.) */
async function expectToast(message: string) {
  await waitFor(() => {
    expect(notifications()).toHaveTextContent(message);
  });
}

/** Renders Settings and waits for its data (the cloud backup's status too) to load. */
async function renderSettings(path: string = paths.settings) {
  const view = renderRoute(path);
  await screen.findByRole('heading', { level: 2, name: 'Player' });
  return view;
}

const cloudList = () => screen.getByRole('list', { name: 'Cloud backup' });
const cloudButton = (name: string | RegExp) => within(cloudList()).getByRole('button', { name });

afterEach(() => {
  restoreStubs();
  localStorage.clear();
});

describe('Settings: cloud backup off', () => {
  it('is left out of a build without a backup server', async () => {
    vi.stubEnv('VITE_BACKUP_API_URL', '');
    await renderSettings();
    expect(screen.queryByRole('heading', { name: 'Cloud backup' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Backup' })).toBeVisible();
  });

  it('explains what it does, and leads to restoring from a code', async () => {
    const { user, router } = await renderSettings();
    expect(screen.getByRole('region', { name: 'Cloud backup' })).toHaveTextContent(
      "Keeps an encrypted copy of your stats online whenever there's signal, so a lost or broken phone doesn't mean lost stats. Only someone with your backup code can read it.",
    );
    // Above the backup files, which still say the stats are only on this phone.
    expect(cloudButton('Turn on cloud backup')).toBeEnabled();
    expect(screen.getByRole('list', { name: 'Backup' }).parentElement).toHaveTextContent(
      'Your stats are stored only on this phone.',
    );

    await user.click(cloudButton('Restore from a backup code'));
    expect(router.state.location.pathname).toBe(paths.restoreBackup());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Restore from backup' }),
    ).toBeVisible();
  });

  it('turns on, shows the code to save, and backs up', async () => {
    await seedOwnGames();
    const { user } = await renderSettings();

    await user.click(cloudButton('Turn on cloud backup'));

    const sheet = await screen.findByRole('dialog', { name: 'Save your backup code' });
    const code = await getBackupCode();
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){6}$/);
    expect(sheet).toHaveAccessibleDescription('Cloud backup is on.');
    // Grouped the way the engine writes it, on two lines to copy by hand.
    const shown = within(sheet).getByText(
      (_, element) => element?.tagName === 'P' && element.textContent === code,
    );
    expect(shown.children).toHaveLength(2);
    expect(sheet).toHaveTextContent(
      "Write it down or save it somewhere safe. It's the only way to restore your online backup, and nobody (not even us) can recover it.",
    );
    // Only "I've saved it" closes it.
    expect(within(sheet).queryByRole('button', { name: 'Close' })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: "I've saved it" }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
    expect(await within(cloudList()).findByText('Backed up just now')).toBeVisible();
    expect(cloud.server.uploads).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Backup' }).parentElement).toHaveTextContent(
      'For a copy you keep yourself, save a backup file now and then',
    );
  });

  it('turns on again with the code it kept, and says so', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    await disableCloudBackup();
    const { user } = await renderSettings();

    const turnOn = cloudButton(/^Turn on cloud backup/);
    expect(turnOn).toHaveTextContent('Uses the same backup code as before.');
    await user.click(turnOn);

    const sheet = await screen.findByRole('dialog', { name: 'Save your backup code' });
    expect(sheet).toHaveAccessibleDescription(
      'Cloud backup is on again, with the same code as before.',
    );
    expect(sheet).toHaveTextContent(code);
    expect(await getBackupCode()).toBe(code);
  });

  it('deletes the online backup it kept, after asking', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    await disableCloudBackup();
    const { user } = await renderSettings();

    await user.click(cloudButton(/^Delete online backup/));
    const question = await screen.findByRole('alertdialog', { name: 'Delete your online backup?' });
    expect(question).toHaveAccessibleDescription(
      "Every backup saved with this code will be deleted, and this phone will forget the code. The stats on this phone stay. This can't be undone.",
    );
    expect(within(question).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(question).getByRole('button', { name: 'Delete online backup' }));

    await expectToast('Online backup deleted');
    expect(await getBackupCode()).toBeUndefined();
    expect(cloud.server.accounts.size).toBe(0);
    await waitFor(() => {
      expect(cloudButton('Turn on cloud backup')).toBeVisible();
    });
    expect(within(cloudList()).queryByRole('button', { name: /Delete online backup/ })).toBeNull();
  });
});

describe('Settings: cloud backup on', () => {
  it('offers a restore while on, for an older backup say', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const { user, router } = await renderSettings();

    const restore = cloudButton(/^Restore from backup/);
    expect(restore).toHaveTextContent(
      'Brings back games from your online backup, or from an older one.',
    );
    await user.click(restore);

    expect(router.state.location.pathname).toBe(paths.restoreBackup());
    const field = await screen.findByLabelText('Backup code');
    await waitFor(() => {
      expect(field).toHaveValue(code);
    });
  });

  it('shows the code again, to copy or share', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const { user } = await renderSettings();

    await user.click(cloudButton('Show backup code'));
    const sheet = await screen.findByRole('dialog', { name: 'Your backup code' });
    expect(sheet).toHaveTextContent(code);

    await user.click(within(sheet).getByRole('button', { name: 'Copy' }));
    await expectToast('Backup code copied');
    expect(await navigator.clipboard.readText()).toBe(code);

    const share = vi.fn(() => Promise.resolve());
    stubProperties(navigator, { share, canShare: vi.fn(() => true) });
    await user.click(within(sheet).getByRole('button', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({
      title: 'Hoop Stats backup code',
      text: `Hoop Stats backup code: ${code}`,
    });

    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('backs up now, busy until it is done', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    const { user } = await renderSettings();
    const release = cloud.server.hold();

    await user.click(cloudButton('Back up now'));
    await waitFor(() => {
      expect(cloudButton('Back up now')).toBeDisabled();
    });
    expect(cloudList()).toHaveTextContent('Backing up…');
    expect(cloudList()).toHaveTextContent('Last backed up just now.');
    release();

    await expectToast('Backed up');
    expect(cloud.server.uploads).toHaveLength(2);
    await waitFor(() => {
      expect(cloudButton('Back up now')).toBeEnabled();
    });
    expect(cloudList()).toHaveTextContent('Backed up just now');
  });

  it("says why a backup failed, and when it'll try again", async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    const { user } = await renderSettings();
    cloud.server.failNext({
      status: 503,
      error: 'server_busy',
      retryAfterSeconds: 300,
      method: 'PUT',
    });

    await user.click(cloudButton('Back up now'));

    const status = await settledStatus();
    expect(status.state).toBe('error');
    const message = status.lastError?.message ?? '';
    expect(message).not.toBe('');
    await expectToast(message);
    // (toHaveTextContent reads the no-break spaces in "8:25 PM" as plain ones.)
    const when = formatWhen(status.nextAttemptAt ?? 0, Date.now()).replace(/\u00a0/g, ' ');
    await waitFor(() => {
      expect(cloudList()).toHaveTextContent(`Backup will try again ${when}`);
    });
    // The reason, without the wait counted from when it failed (that goes stale).
    expect(message).toMatch(/ in 5 minutes\.$/);
    expect(cloudList()).toHaveTextContent('The backup server is busy.');
    expect(cloudList()).not.toHaveTextContent('in 5 minutes');
  });

  it('waits for signal, and says the stats are safe meanwhile', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    cloud.server.networkDown = true;
    await backUpNow();
    expect(await settledStatus()).toMatchObject({ state: 'waiting-for-signal' });

    await renderSettings();

    expect(cloudList()).toHaveTextContent('Waiting for signal: will back up automatically');
    expect(cloudList()).toHaveTextContent(
      'Your stats are safe on this phone. Last backed up just now.',
    );
    // Not something the parent has to fix: no banner.
    expect(screen.queryByRole('complementary', { name: 'Cloud backup' })).toBeNull();
  });

  it('turns off and keeps the online backup and the code', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const { user } = await renderSettings();

    await user.click(cloudButton('Turn off'));
    const sheet = await screen.findByRole('dialog', { name: 'Turn off cloud backup?' });
    expect(sheet).toHaveAccessibleDescription('Your stats stay on this phone either way.');
    await user.click(
      within(sheet).getByRole('button', { name: /^Turn off\s*Keeps your online backup/ }),
    );

    await expectToast('Cloud backup is off');
    await waitFor(() => {
      expect(cloudButton(/^Turn on cloud backup/)).toHaveTextContent(
        'Uses the same backup code as before.',
      );
    });
    expect(await getBackupCode()).toBe(code);
    expect(cloud.server.accounts.size).toBe(1);
  });

  it('turns off and deletes the online backup, after asking', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    const { user } = await renderSettings();

    await user.click(cloudButton('Turn off'));
    const sheet = await screen.findByRole('dialog', { name: 'Turn off cloud backup?' });
    await user.click(
      within(sheet).getByRole('button', { name: /^Turn off and delete online backup/ }),
    );
    const question = await screen.findByRole('alertdialog', { name: 'Delete your online backup?' });
    await user.click(within(question).getByRole('button', { name: 'Delete online backup' }));

    await expectToast('Cloud backup is off, and the online backup is deleted');
    expect(await getBackupCode()).toBeUndefined();
    expect(cloud.server.accounts.size).toBe(0);
    await waitFor(() => {
      expect(cloudButton('Turn on cloud backup')).toBeVisible();
    });
  });

  it("stays on and says why when the online backup can't be deleted", async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const { user } = await renderSettings();
    cloud.server.networkDown = true;

    await user.click(cloudButton('Turn off'));
    const sheet = await screen.findByRole('dialog', { name: 'Turn off cloud backup?' });
    await user.click(
      within(sheet).getByRole('button', { name: /^Turn off and delete online backup/ }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete online backup',
      }),
    );

    await waitFor(() => {
      expect(within(sheet).getByRole('alert')).toHaveTextContent(errorMessage('network', 'delete'));
    });
    expect(screen.getByRole('dialog', { name: 'Turn off cloud backup?' })).toBeVisible();
    expect(await getCloudBackupStatus()).toMatchObject({ enabled: true });
    expect(await getBackupCode()).toBe(code);
  });
});

describe('Settings: cloud backup paused or stopped', () => {
  it('pauses when games are missing, and restores them from the backup', async () => {
    const code = await pauseForMissingGames();
    const { user, router } = await renderSettings();

    expect(cloudList()).toHaveTextContent('Backup paused');
    expect(cloudList()).toHaveTextContent(
      'None of the 10 games in your last backup are on this phone, so automatic backup is paused to keep that backup safe.',
    );
    await user.click(cloudButton(/^Restore from backup/));

    expect(router.state.location.pathname).toBe(paths.restoreBackup());
    const field = await screen.findByLabelText('Backup code');
    await waitFor(() => {
      expect(field).toHaveValue(code);
    });
    await user.click(screen.getByRole('button', { name: 'Find backup' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    // It backed up with this code already: nothing new about that.
    await expectToast('Restored 10 games. This phone keeps backing up with this code.');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.home);
    });
    expect(await listGames()).toHaveLength(10);
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
  });

  it('says the games only online would be lost, before deleting the online backup', async () => {
    await pauseForMissingGames();
    const { user } = await renderSettings();

    await user.click(cloudButton('Turn off'));
    const sheet = await screen.findByRole('dialog', { name: 'Turn off cloud backup?' });
    const deleteRow = within(sheet).getByRole('button', {
      name: /^Turn off and delete online backup/,
    });
    expect(deleteRow).toHaveTextContent(
      "10 games in your online backup aren't on this phone: deleting the online backup loses them for good. Needs an internet connection.",
    );
    await user.click(deleteRow);

    const question = await screen.findByRole('alertdialog', { name: 'Delete your online backup?' });
    expect(question).toHaveAccessibleDescription(
      "10 games in your online backup aren't on this phone, so deleting it loses them for good. Every backup saved with this code will be deleted, and this phone will forget the code. This can't be undone.",
    );
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(cloud.server.accounts.size).toBe(1);
    expect(await getCloudBackupStatus()).toMatchObject({ enabled: true, state: 'paused-shrink' });
  });

  it('backs up anyway after asking, when games are missing', async () => {
    await pauseForMissingGames();
    const { user } = await renderSettings();

    await user.click(cloudButton(/^Back up anyway/));
    const question = await screen.findByRole('alertdialog', { name: 'Back up anyway?' });
    expect(question).toHaveAccessibleDescription(
      "This replaces your online backup with what's on this phone, without the 10 missing games. Older backups stay available for a while: the server keeps your last 20, plus one for each of the last 180 days you backed up.",
    );
    expect(within(question).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(question).getByRole('button', { name: 'Back up anyway' }));

    await expectToast('Backed up');
    expect(cloud.server.uploads).toHaveLength(2);
    expect(await within(cloudList()).findByText('Backed up just now')).toBeVisible();
  });

  it("can't start a restore while backing up anyway replaces the online backup", async () => {
    await pauseForMissingGames();
    const { user } = await renderSettings();
    const release = cloud.server.hold();

    await user.click(cloudButton(/^Back up anyway/));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Back up anyway?' })).getByRole(
        'button',
        { name: 'Back up anyway' },
      ),
    );

    // It shows as backing up (forced past the pause), with restoring held back.
    await waitFor(() => {
      expect(cloudList()).toHaveTextContent('Backing up…');
    });
    expect(cloudButton(/^Restore from backup/)).toBeDisabled();
    release();
    await expectToast('Backed up');
    await waitFor(() => {
      expect(cloudButton(/^Restore from backup/)).toBeEnabled();
    });
  });

  it('pauses when another phone backs up with the code, and takes over after asking', async () => {
    await pauseForAnotherPhone(cloud.server);
    const { user } = await renderSettings();

    expect(cloudList()).toHaveTextContent('Backup paused');
    expect(cloudList()).toHaveTextContent(
      'Another phone backed up with this backup code just now, so this phone stopped backing up to keep from replacing that backup.',
    );
    expect(cloudButton(/^Restore from backup/)).toBeVisible();
    await user.click(cloudButton(/^Use this phone for backups/));
    const question = await screen.findByRole('alertdialog', {
      name: 'Use this phone for backups?',
    });
    expect(question).toHaveAccessibleDescription(
      "This phone's stats will replace the other phone's latest backup, and the other phone's backups will pause, the way this phone's did. Older backups stay available for a while: the server keeps your last 20, plus one for each of the last 180 days you backed up.",
    );
    await user.click(within(question).getByRole('button', { name: 'Use this phone' }));

    await expectToast('Backed up');
    // This phone's, the other phone's, and this phone's again.
    expect(cloud.server.uploads).toHaveLength(3);
    expect(await settledStatus()).toMatchObject({ state: 'idle' });
  });

  it("settles the pause by restoring the other phone's backup", async () => {
    // The other phone has the ten games too, plus a live one.
    const code = await pauseForAnotherPhone(cloud.server, buildRealData({ liveGame: true }));
    const { user, router } = await renderSettings();

    await user.click(cloudButton(/^Restore from backup/));
    const field = await screen.findByLabelText('Backup code');
    await waitFor(() => {
      expect(field).toHaveValue(code);
    });
    await user.click(screen.getByRole('button', { name: 'Find backup' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveAccessibleDescription(/ · 11 games · /);
    await user.click(within(sheet).getByRole('button', { name: /Add to what's on this phone/ }));

    await expectToast(
      'Restored 1 game · 10 already up to date. This phone keeps backing up with this code.',
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(paths.home);
    });
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
    // This phone's, the other phone's, then both phones' games together.
    expect(cloud.server.uploads).toHaveLength(3);
    const latest = await fetchCloudBackup(code);
    expect(latest.ok && latest.value.games).toBe(11);
  });

  it('asks again when backing up anyway turns up another phone', async () => {
    const code = await pauseForMissingGames();
    await backUpFromAnotherPhone(cloud.server, code, buildRealData());
    const { user } = await renderSettings();

    await user.click(cloudButton(/^Back up anyway/));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Back up anyway?' })).getByRole(
        'button',
        { name: 'Back up anyway' },
      ),
    );

    // Not backed up: the other phone's backup is the newest, so it asks about that.
    await expectToast(errorMessage('other-device', 'backup'));
    await waitFor(() => {
      expect(cloudList()).toHaveTextContent('Another phone backed up with this backup code');
    });
    expect(cloud.server.uploads).toHaveLength(2);

    await user.click(cloudButton(/^Use this phone for backups/));
    await user.click(
      within(
        await screen.findByRole('alertdialog', { name: 'Use this phone for backups?' }),
      ).getByRole('button', { name: 'Use this phone' }),
    );
    await expectToast('Backed up');
    expect(cloud.server.uploads).toHaveLength(3);
    expect(await settledStatus()).toMatchObject({ state: 'idle' });
  });

  it('turns off on this phone only, leaving the other phone its backup', async () => {
    const code = await pauseForAnotherPhone(cloud.server);
    const { user } = await renderSettings();

    await user.click(cloudButton('Turn off on this phone'));
    const question = await screen.findByRole('alertdialog', {
      name: 'Turn off cloud backup on this phone?',
    });
    expect(question).toHaveAccessibleDescription(
      'The online backup stays, and the other phone can keep backing up with this code.',
    );
    await user.click(within(question).getByRole('button', { name: 'Turn off' }));

    await expectToast('Cloud backup is off on this phone');
    expect(await getCloudBackupStatus()).toMatchObject({ enabled: false });
    expect(await getBackupCode()).toBe(code);
    expect(cloud.server.uploads).toHaveLength(2);
    expect(cloud.server.accounts.size).toBe(1);
  });

  it('says why backup stopped, and backs up again', async () => {
    await stopForDeletedCloudCopy(cloud.server);
    const status = await settledStatus();
    expect(status.state).toBe('needs-attention');
    const { user } = await renderSettings();

    expect(cloudList()).toHaveTextContent('Backup stopped');
    expect(cloudList()).toHaveTextContent(status.lastError?.message ?? 'a message');
    await user.click(cloudButton('Back up now'));

    await expectToast('Backed up');
    expect(await within(cloudList()).findByText('Backed up just now')).toBeVisible();
    expect(await settledStatus()).toMatchObject({ state: 'idle' });
  });

  it('opens at the Cloud backup section from the backup banner', async () => {
    await pauseForMissingGames();
    await renderSettings(paths.settingsSection('cloud-backup'));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Cloud backup' })).toHaveFocus();
    });
  });

  it('goes back to the section at each tap on the banner', async () => {
    await pauseForMissingGames();
    const scrollIntoView = vi.fn();
    stubProperties(Element.prototype, { scrollIntoView });
    const { user } = await renderSettings();
    const section = () => screen.getByRole('region', { name: 'Cloud backup' });

    // (The banner reads the status on its own, so it may come a moment after Settings.)
    await user.click(
      await screen.findByRole('link', { name: 'Cloud backup is paused. Tap to fix' }),
    );
    await waitFor(() => {
      expect(section()).toHaveFocus();
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // She moves on (the Erase question takes focus, then gives it back), then taps the
    // banner again: the same address, and it still takes her there.
    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Erase all data?' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    await waitFor(() => {
      expect(section()).not.toHaveFocus();
    });
    await user.click(screen.getByRole('link', { name: 'Cloud backup is paused. Tap to fix' }));
    await waitFor(() => {
      expect(section()).toHaveFocus();
    });
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});

describe('Settings: answers that come after the parent has left', () => {
  const settingsGone = () =>
    waitFor(() => {
      expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).toBeNull();
    });

  it('never shows how "Back up now" went over the live game', async () => {
    await seedOwnGames({ liveGame: true });
    await turnOnCloudBackup();
    const { user, router } = await renderSettings();

    const release = cloud.server.hold(); // slow gym signal
    await user.click(cloudButton('Back up now'));
    // She heads for the game while it's still going.
    await router.navigate(paths.trackGame(REAL_LIVE_GAME_ID));
    await settingsGone();
    release();

    expect(await settledStatus()).toMatchObject({ state: 'idle' });
    expect(cloud.server.uploads).toHaveLength(2);
    expect(router.state.location.pathname).toBe(paths.trackGame(REAL_LIVE_GAME_ID));
    expect(notifications()).not.toHaveTextContent('Backed up');
  });

  it("never shows why the online backup wasn't deleted once Settings is gone", async () => {
    await seedOwnGames({ liveGame: true });
    await turnOnCloudBackup();
    const { user, router } = await renderSettings();
    await user.click(cloudButton('Turn off'));
    const sheet = await screen.findByRole('dialog', { name: 'Turn off cloud backup?' });

    const release = cloud.server.hold();
    await user.click(
      within(sheet).getByRole('button', { name: /^Turn off and delete online backup/ }),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete online backup',
      }),
    );
    await waitFor(() => {
      expect(cloud.server.requests.map(({ method }) => method)).toContain('DELETE');
    });
    // She gives up waiting, closes the sheet and goes to the game.
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await router.navigate(paths.trackGame(REAL_LIVE_GAME_ID));
    await settingsGone();
    // The signal drops before the server answers: nothing was deleted.
    cloud.server.networkDown = true;
    release();

    await waitFor(async () => {
      expect(await getCloudBackupStatus()).toMatchObject({ enabled: true });
    });
    await whenBackupIdle();
    expect(cloud.server.accounts.size).toBe(1);
    expect(router.state.location.pathname).toBe(paths.trackGame(REAL_LIVE_GAME_ID));
    expect(notifications()).not.toHaveTextContent(errorMessage('network', 'delete'));
  });
});

describe('Settings: erasing all data with cloud backup', () => {
  const ERASED =
    "All 10 games and their stats, the player's name and number, and your settings will be deleted from this phone. This can't be undone.";
  const SAVE_A_FILE = 'If you might want them back, save a backup file first.';
  const backupFilesNote = () => screen.getByRole('list', { name: 'Backup' }).parentElement;

  /** Taps "Erase all data" and returns its question. */
  async function eraseQuestion(user: ReturnType<typeof renderRoute>['user']) {
    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    return screen.getByRole('alertdialog', { name: 'Erase all data?' });
  }

  it("says an online backup with everything stays, and won't be replaced by the empty phone", async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const { user } = await renderSettings();

    const dialog = await eraseQuestion(user);
    expect(dialog).toHaveAccessibleDescription(
      `${ERASED} Your online backup has all of it and stays: this phone keeps its code and won't replace the backup with an empty phone. To delete it too, first use Turn off and delete online backup in Cloud backup. For a copy of your own as well, save a backup file first.`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Erase all data' }));

    await expectToast('All data erased');
    expect(await getBackupCode()).toBe(code);
    await backUpNow();
    expect(await settledStatus()).toMatchObject({ state: 'paused-shrink' });
    expect(cloud.server.uploads).toHaveLength(1);
  });

  it('says backup is paused as soon as the phone is erased, before any upload is tried', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    const { user } = await renderSettings();

    const dialog = await eraseQuestion(user);
    await user.click(within(dialog).getByRole('button', { name: 'Erase all data' }));

    await expectToast('All data erased');
    // Not "Backed up just now · Newer changes will back up soon" until an upload finds
    // out (the scheduler isn't even running here): the data alone says so.
    await waitFor(() => {
      expect(cloudList()).toHaveTextContent('Backup paused');
    });
    expect(cloudList()).toHaveTextContent(
      'None of the 10 games in your last backup are on this phone, so automatic backup is paused to keep that backup safe.',
    );
    expect(cloudButton(/Back up anyway/)).toBeEnabled();
    // The banner reads the status on its own (a live query of its own, like the
    // section's), so it can show the pause a moment after the section does.
    expect(
      await screen.findByRole('link', { name: 'Cloud backup is paused. Tap to fix' }),
    ).toBeInTheDocument();
    expect(cloud.server.uploads).toHaveLength(1);
  });

  it('says a backup file saved since has all of it too, instead of asking for one', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    captureDownloads();
    const { user } = await renderSettings();
    const save = screen.getByRole('button', { name: /Save a backup file/ });
    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    await user.click(save);
    const today = formatDayWithYear(Date.now());
    await waitFor(() => {
      expect(save).toHaveTextContent(`Last saved: ${today}`);
    });

    expect(await eraseQuestion(user)).toHaveAccessibleDescription(
      `${ERASED} Your online backup has all of it and stays: this phone keeps its code and won't replace the backup with an empty phone. To delete it too, first use Turn off and delete online backup in Cloud backup. The backup file you saved on ${today} has all of it too.`,
    );
  });

  it("says what isn't backed up yet while changes wait for signal", async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    cloud.server.networkDown = true;
    await createGame({ opponent: 'Hillcrest', date: '2026-09-28', periodFormat: 'quarters' });
    await backUpNow();
    expect(await settledStatus()).toMatchObject({
      state: 'waiting-for-signal',
      pendingChanges: true,
    });
    const { user } = await renderSettings();

    expect(await eraseQuestion(user)).toHaveAccessibleDescription(
      `${ERASED.replace('10', '11')} This phone last backed up just now, so anything changed since then isn't in your online backup. ${SAVE_A_FILE}`,
    );
    // It will catch up by itself, so the backup files' note doesn't say "only here".
    expect(backupFilesNote()).toHaveTextContent('For a copy you keep yourself');
  });

  it('says nothing since backup was turned off is in the online backup', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    await disableCloudBackup();
    // A game recorded after backup was turned off: it's only on this phone.
    await createGame({ opponent: 'Hillcrest', date: '2026-09-28', periodFormat: 'quarters' });
    const { user } = await renderSettings();

    expect(await eraseQuestion(user)).toHaveAccessibleDescription(
      `${ERASED.replace('10', '11')} Cloud backup is off, so nothing changed since it was turned off is in your online backup. ${SAVE_A_FILE}`,
    );
    expect(backupFilesNote()).toHaveTextContent('Your stats are stored only on this phone.');
  });

  it('says the online backup was deleted, when that stopped backup', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    // The online backup is deleted (from another phone with the same code, say)...
    const keys = await deriveBackupKeys(parseBackupCode(code));
    const api = createBackupApi({ baseUrl: TEST_API_URL, fetch: cloud.server.fetch });
    expect((await api.deleteAll(keys)).ok).toBe(true);
    // ...and this phone finds out when its next upload is refused.
    cloud.server.failNext({ status: 409, error: 'account_deleted', method: 'PUT' });
    await backUpNow();
    expect(await settledStatus()).toMatchObject({ state: 'needs-attention' });
    const { user } = await renderSettings();

    expect(await eraseQuestion(user)).toHaveAccessibleDescription(
      `${ERASED} Your online backup was deleted, so none of this is backed up online. ${SAVE_A_FILE}`,
    );
    expect(backupFilesNote()).toHaveTextContent('Your stats are stored only on this phone.');
  });

  it("says so when this phone hasn't backed up yet", async () => {
    await seedOwnGames();
    // Turned on with no signal: nothing is online yet.
    cloud.server.networkDown = true;
    await turnOnCloudBackup();
    expect(await settledStatus()).toMatchObject({ state: 'waiting-for-signal' });
    const { user } = await renderSettings();

    expect(await eraseQuestion(user)).toHaveAccessibleDescription(
      `${ERASED} This phone hasn't backed up online yet. ${SAVE_A_FILE}`,
    );
    expect(backupFilesNote()).toHaveTextContent('Your stats are stored only on this phone.');
  });

  it('says the latest stats are only here when backup stopped for another reason', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    await createGame({ opponent: 'Hillcrest', date: '2026-09-28', periodFormat: 'quarters' });
    // The server no longer takes this code.
    cloud.server.failNext({ status: 401, error: 'unauthorized', method: 'PUT' });
    await backUpNow();
    expect(await settledStatus()).toMatchObject({ state: 'needs-attention' });
    const { user } = await renderSettings();

    expect(await eraseQuestion(user)).toHaveAccessibleDescription(
      `${ERASED.replace('10', '11')} Cloud backup has stopped, so your latest stats aren't backed up online. ${SAVE_A_FILE}`,
    );
    expect(backupFilesNote()).toHaveTextContent('Your latest stats are stored only on this phone.');
  });

  it("while paused for another phone, names no row that isn't there", async () => {
    await pauseForAnotherPhone(cloud.server);
    const { user } = await renderSettings();

    const dialog = await eraseQuestion(user);
    expect(dialog).toHaveAccessibleDescription(
      `${ERASED} This phone last backed up just now, so anything changed since then isn't in your online backup. ${SAVE_A_FILE}`,
    );
    expect(within(cloudList()).queryByRole('button', { name: 'Turn off' })).toBeNull();
    expect(backupFilesNote()).toHaveTextContent('Your latest stats are stored only on this phone.');
  });

  it('says nothing about cloud backup on a phone without a code', async () => {
    await seedOwnGames();
    const { user } = await renderSettings();

    expect(await eraseQuestion(user)).toHaveAccessibleDescription(`${ERASED} ${SAVE_A_FILE}`);
  });
});
