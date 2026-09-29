import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreStubs, stubProperties } from '@/test/browser';
import { resetDatabase } from '@/test/db';
import { createBackupApi } from '@/data/backup/api';
import {
  backUpNow,
  disableCloudBackup,
  enableCloudBackupWithCode,
  fetchCloudBackup,
  getBackupCode,
  type CloudBackup,
} from '@/data/backup/cloudBackup';
import { BackupCodeError, generateBackupCode, parseBackupCode } from '@/data/backup/code';
import { cloudFailure, errorMessage } from '@/data/backup/errors';
import { deriveBackupKeys } from '@/data/backup/keys';
import type { DemoOptions } from '@/data/demo';
import { clearAllData, type ExportFile } from '@/data/transfer';
import { createGame, deleteGame, getPlayer, listGames } from '@/data/repo';
import { paths } from '@/routes';
import { buildRealData, REAL_LIVE_GAME_ID, realGameId, TEST_API_URL } from '@/test/backupHarness';
import {
  backUpFromAnotherPhone,
  seedOwnGames,
  settledStatus,
  setUpFakeCloudBackup,
  turnOnCloudBackup,
} from '@/test/cloudBackupApp';
import { renderRoute } from '@/test/render';
import { cloudBackupSummary } from './cloudBackupText';
import type * as CloudBackupModule from '@/data/backup/cloudBackup';

// The real API, but a test can hold back turning backup on after a restore.
vi.mock('@/data/backup/cloudBackup', async (importOriginal) => {
  const actual = await importOriginal<typeof CloudBackupModule>();
  return {
    ...actual,
    enableCloudBackupWithCode: vi.fn(actual.enableCloudBackupWithCode),
  };
});

const cloud = setUpFakeCloudBackup();

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

async function expectToast(message: string) {
  await waitFor(() => {
    expect(notifications()).toHaveTextContent(message);
  });
}

/** A phone backs up its ten games; then it's a new phone: nothing on it, not even the code. */
async function backUpThenNewPhone(
  options: DemoOptions = {},
): Promise<{ code: string; backup: CloudBackup }> {
  await seedOwnGames(options);
  const code = await turnOnCloudBackup();
  const fetched = await fetchCloudBackup(code);
  if (!fetched.ok) throw new Error(fetched.error.message);
  await resetDatabase();
  return { code, backup: fetched.value };
}

async function renderRestore(path = paths.restoreBackup()) {
  const view = renderRoute(path);
  const field = await screen.findByLabelText('Backup code');
  return { ...view, field };
}

/** Types a code and taps Find backup. */
async function find(view: Awaited<ReturnType<typeof renderRestore>>, code: string) {
  await view.user.clear(view.field);
  await view.user.type(view.field, code);
  await view.user.click(screen.getByRole('button', { name: 'Find backup' }));
}

/** After a restore: backup is on with the code once the screen has gone on to Games. */
async function expectGames(view: Awaited<ReturnType<typeof renderRestore>>) {
  await waitFor(() => {
    expect(view.router.state.location.pathname).toBe(paths.home);
  });
}

/** What the engine says about a code that can't be right (checked here, offline). */
function codeProblem(code: string): string {
  try {
    parseBackupCode(code);
  } catch (error) {
    if (error instanceof BackupCodeError) return error.message;
  }
  throw new Error(`${code} is a good code`);
}

/** The same code with one character changed. */
function withTypo(code: string): string {
  const last = code.at(-1) === '0' ? '1' : '0';
  return `${code.slice(0, -1)}${last}`;
}

/** The same season under other ids: a partner's games, not this phone's. */
function partnersData(): ExportFile {
  const data = buildRealData();
  const rename = (id: string) => `partner-${id}`;
  return {
    ...data,
    games: data.games.map((game) => ({ ...game, id: rename(game.id) })),
    events: data.events.map((event) => ({
      ...event,
      id: rename(event.id),
      gameId: rename(event.gameId),
    })),
  };
}

afterEach(() => {
  restoreStubs();
});

describe('Restore from a backup code', () => {
  it('catches a typo before sending anything', async () => {
    const code = generateBackupCode();
    const view = await renderRestore();

    await find(view, withTypo(code));

    expect(view.field).toBeInvalid();
    expect(view.field).toHaveAccessibleDescription(
      expect.stringContaining(codeProblem(withTypo(code))) as string,
    );
    expect(view.field).toHaveAccessibleDescription(expect.stringContaining('typo') as string);
    expect(view.field).toHaveFocus();
    expect(cloud.server.requests).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Typing again clears the error.
    await view.user.type(view.field, 'X');
    expect(view.field).toBeValid();
  });

  it('says when there is no backup for a code', async () => {
    const view = await renderRestore();

    await find(view, generateBackupCode());

    await waitFor(() => {
      expect(view.field).toHaveAccessibleDescription(
        expect.stringContaining(errorMessage('unauthorized', 'restore')) as string,
      );
    });
    expect(view.field).toBeInvalid();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when there is no signal', async () => {
    stubProperties(navigator, { onLine: false });
    const view = await renderRestore();

    await find(view, generateBackupCode());

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(errorMessage('offline', 'restore'));
    });
    expect(view.field).toBeValid();
    expect(cloud.server.requests).toEqual([]);
  });

  it('shows what the newest backup holds, from when the phone made it', async () => {
    const { code, backup } = await backUpThenNewPhone();
    const view = await renderRestore();
    expect(view.field).toHaveValue('');
    expect(view.field).toHaveAccessibleDescription(
      "28 letters and numbers. Capitals, spaces and dashes don't matter.",
    );

    // However it's typed: lowercase, spaces instead of dashes.
    await find(view, code.toLowerCase().replaceAll('-', ' '));

    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveAccessibleDescription(cloudBackupSummary(backup).join(' · '));
    expect(sheet).toHaveAccessibleDescription(/^Backup from .+ · 10 games · Ava #12$/);
    expect(sheet).toHaveTextContent(
      'There are no games on this phone yet, so nothing will be lost.',
    );
  });

  it('restores on a new phone, then backs up with the code', async () => {
    const { code } = await backUpThenNewPhone();
    const view = await renderRestore(paths.restoreBackup('games'));

    await find(view, code);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await view.user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    await expectToast('Restored 10 games. This phone now backs up with this code.');
    await expectGames(view);
    expect(await screen.findByRole('heading', { level: 1, name: 'Games' })).toBeVisible();
    expect(await listGames()).toHaveLength(10);
    expect(await getPlayer()).toMatchObject({ name: 'Ava', jerseyNumber: '12' });
    expect(await getBackupCode()).toBe(code);
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
    // It carried on with the same cloud copy.
    expect(cloud.server.accounts.size).toBe(1);
    expect(cloud.server.uploads).toHaveLength(2);
  });

  it("adds the backup to what's on the phone", async () => {
    const { code } = await backUpThenNewPhone();
    await createGame({ opponent: 'Hillcrest', date: '2026-09-28', periodFormat: 'quarters' });
    const view = await renderRestore();

    await find(view, code);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await view.user.click(
      within(sheet).getByRole('button', { name: /Add to what's on this phone/ }),
    );

    await expectToast('Restored 10 games. This phone now backs up with this code.');
    await expectGames(view);
    expect(await listGames()).toHaveLength(11);
    expect(await getBackupCode()).toBe(code);
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
  });

  it('replaces everything on the phone after asking', async () => {
    const { code } = await backUpThenNewPhone();
    await createGame({ opponent: 'Hillcrest', date: '2026-09-28', periodFormat: 'quarters' });
    const view = await renderRestore();

    await find(view, code);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await view.user.click(
      within(sheet).getByRole('button', { name: /Replace everything on this phone/ }),
    );
    const question = screen.getByRole('alertdialog', { name: 'Replace everything on this phone?' });
    expect(within(question).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await view.user.click(within(question).getByRole('button', { name: 'Replace everything' }));

    await expectToast('Restored 10 games. This phone now backs up with this code.');
    await expectGames(view);
    const games = await listGames();
    expect(games).toHaveLength(10);
    expect(games.map((game) => game.opponent)).not.toContain('Hillcrest');
    expect(await getBackupCode()).toBe(code);
  });

  it('fills in the code this phone already has', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const view = await renderRestore();

    await waitFor(() => {
      expect(view.field).toHaveValue(code);
    });
    expect(view.field).toHaveAccessibleDescription("This phone's backup code is filled in.");
    await view.user.click(screen.getByRole('button', { name: 'Find backup' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    // Its own code: no switching, and no warning.
    expect(sheet).toHaveTextContent('After restoring, this phone backs up with this code.');
    expect(sheet).not.toHaveTextContent('This phone will switch backup codes');
  });

  it('says afterwards that this phone keeps backing up with its own code', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const view = await renderRestore();
    await waitFor(() => {
      expect(view.field).toHaveValue(code);
    });

    await view.user.click(screen.getByRole('button', { name: 'Find backup' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await view.user.click(within(sheet).getByRole('button', { name: /Replace everything/ }));
    await view.user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Replace everything' }),
    );

    await expectToast('Restored 10 games. This phone keeps backing up with this code.');
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
  });

  it('says afterwards that this phone backs up with its own code again, once it was off', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    await disableCloudBackup();
    await clearAllData();
    const view = await renderRestore();
    // Off, the phone keeps its code: it's filled in.
    await waitFor(() => {
      expect(view.field).toHaveValue(code);
    });

    await view.user.click(screen.getByRole('button', { name: 'Find backup' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await view.user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    await expectToast('Restored 10 games. This phone now backs up with this code.');
    expect(await settledStatus()).toMatchObject({ enabled: true });
  });

  it('says before restoring that this phone will back up with the code', async () => {
    const { code } = await backUpThenNewPhone();
    const view = await renderRestore();

    await find(view, code);

    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveTextContent('After restoring, this phone backs up with this code.');
    expect(sheet).not.toHaveTextContent('This phone will switch backup codes');
  });

  it('warns before switching this phone to another code, with its own code to save', async () => {
    // This phone backed up its own ten games under `own`, then backup was turned off.
    await seedOwnGames();
    const own = await turnOnCloudBackup();
    await disableCloudBackup();
    // A partner's backup, under another code, with games of their own.
    const partner = generateBackupCode();
    await backUpFromAnotherPhone(cloud.server, partner, partnersData());
    const view = await renderRestore();
    await waitFor(() => {
      expect(view.field).toHaveValue(own);
    });

    await find(view, partner);

    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveTextContent(
      'This phone will switch backup codes' +
        'After restoring, it backs up with the code you entered and forgets its current one, the only way to restore its own online backup. Save the current code first if you might need that backup:' +
        own,
    );
    // Her own code, ready to save first.
    await view.user.click(within(sheet).getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe(own);

    await view.user.click(
      within(sheet).getByRole('button', { name: /Replace everything on this phone/ }),
    );
    const question = screen.getByRole('alertdialog', { name: 'Replace everything on this phone?' });
    expect(question).toHaveAccessibleDescription(
      /This phone will also switch to the backup code you entered\.$/,
    );
    await view.user.click(within(question).getByRole('button', { name: 'Replace everything' }));

    await expectToast('Restored 10 games. This phone now backs up with this code.');
    await expectGames(view);
    expect(await getBackupCode()).toBe(partner);
    expect((await listGames()).every((game) => game.id.startsWith('partner-'))).toBe(true);
    // Its own backup is still there, for the code she saved.
    const kept = await fetchCloudBackup(own);
    expect(kept.ok && kept.value.games).toBe(10);
  });

  it('says so before an Add that finds nothing new switches codes too', async () => {
    await seedOwnGames();
    const own = await turnOnCloudBackup();
    await disableCloudBackup();
    // The partner's backup holds the same games (restored from this phone's file, say).
    const partner = generateBackupCode();
    await backUpFromAnotherPhone(cloud.server, partner, buildRealData());
    const view = await renderRestore();
    await waitFor(() => {
      expect(view.field).toHaveValue(own);
    });

    await find(view, partner);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveTextContent('This phone will switch backup codes');
    await view.user.click(
      within(sheet).getByRole('button', { name: /Add to what's on this phone/ }),
    );

    const result = within(sheet).getByRole('status', { name: 'Restore result' });
    await waitFor(() => {
      expect(result).toHaveTextContent(/This phone now backs up with this code\.$/);
    });
    expect(await getBackupCode()).toBe(partner);
  });

  it('takes a code pasted with the label a shared one has', async () => {
    const { code } = await backUpThenNewPhone();
    const view = await renderRestore();

    await view.user.click(view.field);
    await view.user.paste(`Hoop Stats backup code: ${code}`);
    await view.user.click(screen.getByRole('button', { name: 'Find backup' }));

    expect(await screen.findByRole('dialog', { name: 'Restore this backup?' })).toBeVisible();
  });

  it('restores an older backup, and carries on backing up from the newest', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    // The newest backup lost a game.
    await deleteGame(realGameId(1));
    expect((await backUpNow()).ok).toBe(true);
    await resetDatabase();
    const view = await renderRestore();

    await find(view, code);
    const newest = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(newest).toHaveAccessibleDescription(/ · 9 games · /);
    await view.user.click(within(newest).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    const older = screen.getByRole('list', { name: 'Older backups' });
    await view.user.click(within(older).getByRole('button', { name: 'Show older backups' }));
    const rows = await within(older).findAllByRole('button');
    expect(rows).toHaveLength(1);
    await view.user.click(rows[0] as HTMLElement);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveAccessibleDescription(/ · 10 games · /);
    await view.user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    await expectToast('Restored 10 games. This phone now backs up with this code.');
    await expectGames(view);
    expect(await listGames()).toHaveLength(10);
    // Not taken for another phone's backup: it backed up the ten games as the newest.
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
    expect(cloud.server.uploads).toHaveLength(3);
    const latest = await fetchCloudBackup(code);
    expect(latest.ok && latest.value.games).toBe(10);
  });

  it('offers the older backups when the newest one is damaged', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    const keys = await deriveBackupKeys(parseBackupCode(code));
    await createBackupApi({ baseUrl: TEST_API_URL, fetch: cloud.server.fetch }).upload(
      keys,
      new Uint8Array(64).fill(7),
    );
    await resetDatabase();
    const view = await renderRestore();

    await find(view, code);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(errorMessage('damaged', 'restore'));
    });
    const older = screen.getByRole('list', { name: 'Older backups' });
    await view.user.click(within(older).getByRole('button', { name: 'Show older backups' }));
    await view.user.click((await within(older).findAllByRole('button'))[0] as HTMLElement);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveAccessibleDescription(/ · 10 games · /);
  });

  it('goes back to where it was opened from', async () => {
    const fromSettings = await renderRestore();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    fromSettings.unmount();

    const fromGames = await renderRestore(paths.restoreBackup('games'));
    await fromGames.user.click(screen.getByRole('link', { name: 'Games' }));
    expect(fromGames.router.state.location.pathname).toBe(paths.home);
  });

  it('points to backup files, and explains a build without cloud backup', async () => {
    vi.stubEnv('VITE_BACKUP_API_URL', '');
    renderRoute(paths.restoreBackup());
    expect(
      await screen.findByText("Cloud backup isn't available in this version of Hoop Stats.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText('Backup code')).toBeNull();
    expect(screen.getByRole('link', { name: 'Restore a backup file in Settings' })).toHaveAttribute(
      'href',
      paths.settings,
    );
  });
});

describe('Restore from a backup code: after the restore', () => {
  it('closes and says so as soon as the stats are on the phone, even without signal', async () => {
    // A phone backed up its games, including a live one; then a new phone.
    const { code } = await backUpThenNewPhone({ liveGame: true });
    const view = await renderRestore(paths.restoreBackup('games'));
    await find(view, code);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });

    // Bad signal in the gym: the server doesn't answer now.
    const release = cloud.server.hold();
    await view.user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    await expectToast('Restored 11 games. This phone now backs up with this code.');
    await expectGames(view);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await getBackupCode()).toBe(code);
    release();
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
  });

  it('never leaves the screen the parent has gone to meanwhile', async () => {
    const { code } = await backUpThenNewPhone({ liveGame: true });
    const view = await renderRestore(paths.restoreBackup('games'));
    await find(view, code);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    // Turning backup on takes its time (it waits for a turn-off still going, say).
    let finish = () => Promise.resolve();
    const actual = vi.mocked(enableCloudBackupWithCode).getMockImplementation();
    vi.mocked(enableCloudBackupWithCode).mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          finish = async () => {
            if (actual) resolve(await actual(...args));
          };
        }),
    );
    await view.user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));
    await expectToast('Restored 11 games. This phone now backs up with this code.');

    // She heads for the live game before it's done.
    await view.router.navigate(paths.trackGame(REAL_LIVE_GAME_ID));
    await finish();
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
    expect(view.router.state.location.pathname).toBe(paths.trackGame(REAL_LIVE_GAME_ID));
  });

  it('says so when backup then fails to turn on', async () => {
    const { code } = await backUpThenNewPhone();
    const view = await renderRestore(paths.restoreBackup('games'));
    await find(view, code);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    // This phone's storage fails as backup is turned on.
    vi.mocked(enableCloudBackupWithCode).mockResolvedValueOnce(
      cloudFailure('unexpected', 'restore'),
    );
    await view.user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    await expectToast(
      `Cloud backup couldn't be turned on. ${errorMessage('unexpected', 'restore')}`,
    );
    await expectGames(view);
    expect(await listGames()).toHaveLength(10);
    expect(await getBackupCode()).toBeUndefined();
  });

  it('says so, instead of what the sheet said, after an Add that found nothing new', async () => {
    await seedOwnGames();
    const own = await turnOnCloudBackup();
    await disableCloudBackup();
    const partner = generateBackupCode();
    await backUpFromAnotherPhone(cloud.server, partner, buildRealData());
    const view = await renderRestore();
    await waitFor(() => {
      expect(view.field).toHaveValue(own);
    });
    await find(view, partner);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    vi.mocked(enableCloudBackupWithCode).mockResolvedValueOnce(
      cloudFailure('unexpected', 'restore'),
    );
    await view.user.click(
      within(sheet).getByRole('button', { name: /Add to what's on this phone/ }),
    );

    await expectToast(
      `Cloud backup couldn't be turned on. ${errorMessage('unexpected', 'restore')}`,
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    // Still here, to try again; the phone kept its own code.
    expect(view.router.state.location.pathname).toBe(paths.restoreBackup());
    expect(await getBackupCode()).toBe(own);
  });

  it('restores an older backup without asking the server for the newest', async () => {
    await seedOwnGames();
    const code = await turnOnCloudBackup();
    await deleteGame(realGameId(1));
    expect((await backUpNow()).ok).toBe(true);
    await resetDatabase();
    const view = await renderRestore();
    await find(view, code);
    const newest = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await view.user.click(within(newest).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const older = screen.getByRole('list', { name: 'Older backups' });
    await view.user.click(within(older).getByRole('button', { name: 'Show older backups' }));
    await view.user.click((await within(older).findAllByRole('button'))[0] as HTMLElement);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });

    // The server can't say which backup is the newest just now: nothing needs it to.
    cloud.server.failNext({ status: 503, error: 'server_busy', method: 'HEAD' });
    await view.user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));
    await expectGames(view);
    expect(await listGames()).toHaveLength(10);
    // Not taken for another phone's backup: the older one's ten games went up as the newest.
    expect(await settledStatus()).toMatchObject({ enabled: true, state: 'idle' });
    const latest = await fetchCloudBackup(code);
    expect(latest.ok && latest.value.games).toBe(10);
  });
});
