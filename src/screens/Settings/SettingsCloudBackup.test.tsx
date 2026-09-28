import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreStubs, stubProperties } from '@/test/browser';
import {
  backUpNow,
  disableCloudBackup,
  fetchCloudBackup,
  getBackupCode,
  getCloudBackupStatus,
} from '@/data/backup/cloudBackup';
import { errorMessage } from '@/data/backup/errors';
import { listGames } from '@/data/repo';
import { paths } from '@/routes';
import { buildRealData } from '@/test/backupHarness';
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
import { formatWhen } from './cloudBackupText';

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

    await user.click(within(cloudList()).getByRole('link', { name: 'Restore from a backup code' }));
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
      "Write it down or save it somewhere safe. It's the only way to get your stats onto a new phone, and nobody (not even us) can recover it.",
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
    await waitFor(() => {
      expect(cloudList()).toHaveTextContent(
        `Backup will try again ${formatWhen(status.nextAttemptAt ?? 0, Date.now())}`,
      );
    });
    expect(cloudList()).toHaveTextContent(message);
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
    await user.click(within(cloudList()).getByRole('link', { name: /^Restore from backup/ }));

    expect(router.state.location.pathname).toBe(paths.restoreBackup());
    const field = await screen.findByLabelText('Backup code');
    await waitFor(() => {
      expect(field).toHaveValue(code);
    });
    await user.click(screen.getByRole('button', { name: 'Find backup' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    await expectToast('Restored 10 games. This phone now backs up with this code.');
    expect(router.state.location.pathname).toBe(paths.home);
    expect(await listGames()).toHaveLength(10);
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
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

  it('pauses when another phone backs up with the code, and takes over after asking', async () => {
    await pauseForAnotherPhone(cloud.server);
    const { user } = await renderSettings();

    expect(cloudList()).toHaveTextContent('Backup paused');
    expect(cloudList()).toHaveTextContent(
      'Another phone backed up with this backup code just now, so this phone stopped backing up to keep from replacing that backup.',
    );
    expect(within(cloudList()).getByRole('link', { name: /^Restore from backup/ })).toBeVisible();
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

    await user.click(within(cloudList()).getByRole('link', { name: /^Restore from backup/ }));
    const field = await screen.findByLabelText('Backup code');
    await waitFor(() => {
      expect(field).toHaveValue(code);
    });
    await user.click(screen.getByRole('button', { name: 'Find backup' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveAccessibleDescription(/ · 11 games · /);
    await user.click(within(sheet).getByRole('button', { name: /Add to what's on this phone/ }));

    await expectToast(
      'Restored 1 game · 10 already up to date. This phone now backs up with this code.',
    );
    expect(router.state.location.pathname).toBe(paths.home);
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
});

describe('Settings: erasing all data with cloud backup', () => {
  it("says the online backup stays, and won't be replaced by the empty phone", async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Erase all data?' });
    expect(dialog).toHaveAccessibleDescription(
      "All 10 games and their stats, the player's name and number, and your settings will be deleted from this phone. This can't be undone. Your online backup isn't deleted: this phone keeps its backup code and won't replace the online backup with an empty phone. To delete the online backup too, first use Turn off and delete online backup in Cloud backup.",
    );
    await user.click(within(dialog).getByRole('button', { name: 'Erase all data' }));

    await expectToast('All data erased');
    expect(await getBackupCode()).toBe(code);
    await backUpNow();
    expect(await settledStatus()).toMatchObject({ state: 'paused-shrink' });
    expect(cloud.server.uploads).toHaveLength(1);
  });

  it('points to Delete online backup while backup is off with its code kept', async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    await disableCloudBackup();
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Erase all data?' }),
    ).toHaveAccessibleDescription(
      /To delete the online backup too, first use Delete online backup in Cloud backup\.$/,
    );
  });

  it('says nothing about cloud backup on a phone without a code', async () => {
    await seedOwnGames();
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    expect(
      screen.getByRole('alertdialog', { name: 'Erase all data?' }),
    ).toHaveAccessibleDescription(
      "All 10 games and their stats, the player's name and number, and your settings will be deleted from this phone. This can't be undone. If you might want them back, save a backup file first.",
    );
  });
});
