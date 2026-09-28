import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreStubs } from '@/components/InstallBanner/testing';
import { seedDemoData } from '@/data/demo';
import { createGame, endGame, getPlayer, listGames, recordStat, savePlayer } from '@/data/repo';
import { parseExportFile } from '@/data/transfer';
import { todayLocalISO } from '@/lib/format';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import fixtureJson from '../../../e2e/fixtures/settings-backup.json?raw';
import { formatDayWithYear } from './backupFiles';
import { GAMES_CSV_HEADERS } from './gamesCsv';
import { captureDownloads, sharedFile, stubFileSharing } from './testUtils';

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

/** Waits for a toast. (Re-queried: the toast area moves into a sheet while one is open.) */
async function expectToast(message: string) {
  await waitFor(() => {
    expect(notifications()).toHaveTextContent(message);
  });
}
const backupList = () => screen.getByRole('list', { name: 'Backup' });
const backupFileName = () => `hoop-stats-backup-${todayLocalISO()}.json`;

/** Renders Settings and waits until the backup rows are ready to use. */
async function renderSettings() {
  const view = renderRoute(paths.settings);
  await screen.findByRole('heading', { level: 2, name: 'Backup' });
  return view;
}

async function enabledButton(name: RegExp | string) {
  const button = within(backupList()).getByRole('button', { name });
  await waitFor(() => {
    expect(button).toBeEnabled();
  });
  return button;
}

/** A backup file the parent might pick in the Files app. */
function pickedFile(contents: string, name = 'hoop-stats-backup-2026-09-20.json') {
  return new File([contents], name, { type: 'application/json' });
}

async function chooseBackupFile(user: ReturnType<typeof renderRoute>['user'], file: File) {
  await user.upload(screen.getByLabelText('Backup file to restore'), file);
}

/** One game on this phone that isn't in the fixture. */
async function seedPhoneGame() {
  await savePlayer({ name: 'Ava', jerseyNumber: '12' });
  const game = await createGame({
    opponent: 'Lincoln',
    date: '2026-09-26',
    periodFormat: 'quarters',
  });
  await recordStat(game.id, 'fg3_made');
  await endGame(game.id, { teamScore: 40, opponentScore: 38 });
  return game;
}

afterEach(() => {
  restoreStubs();
  localStorage.clear();
});

describe('Settings: save a backup file', () => {
  it('shares the backup as a file where the share sheet takes files', async () => {
    await seedDemoData({ today: '2026-09-28' });
    const share = stubFileSharing();
    const downloads = captureDownloads();
    const { user } = await renderSettings();
    expect(
      within(backupList()).getByRole('button', { name: /Save a backup file/ }),
    ).toHaveTextContent('Not saved on this phone yet');

    await user.click(await enabledButton(/Save a backup file/));

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ files: [expect.any(File)] });
    const file = sharedFile(share);
    expect(file.name).toBe(backupFileName());
    expect(file.type).toBe('application/json');
    const backup = parseExportFile(await file.text());
    expect(backup.games).toHaveLength(10);
    expect(backup.players).toEqual([expect.objectContaining({ name: 'Ava', jerseyNumber: '12' })]);
    expect(downloads).toEqual([]);

    await expectToast('Backup file saved');
    expect(
      within(backupList()).getByRole('button', { name: /Save a backup file/ }),
    ).toHaveTextContent(`Last saved: ${formatDayWithYear(Date.now())}`);
  });

  it('downloads the backup where files cannot be shared', async () => {
    await seedDemoData({ today: '2026-09-28' });
    const downloads = captureDownloads();
    const { user, unmount } = await renderSettings();

    await user.click(await enabledButton(/Save a backup file/));

    await expectToast('Backup file downloaded');
    expect(downloads.map((download) => download.name)).toEqual([backupFileName()]);
    const backup = parseExportFile(await (downloads[0]?.file as Blob).text());
    expect(backup.games).toHaveLength(10);

    // "Last saved" is remembered on this device.
    unmount();
    await renderSettings();
    expect(
      within(backupList()).getByRole('button', { name: /Save a backup file/ }),
    ).toHaveTextContent(`Last saved: ${formatDayWithYear(Date.now())}`);
  });

  it('remembers nothing when the share sheet is closed', async () => {
    await seedDemoData({ today: '2026-09-28' });
    const share = stubFileSharing(() =>
      Promise.reject(new DOMException('Share canceled', 'AbortError')),
    );
    const downloads = captureDownloads();
    const { user } = await renderSettings();
    const save = await enabledButton(/Save a backup file/);

    await user.click(save);

    await waitFor(() => {
      expect(save).toBeEnabled();
    });
    expect(share).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual([]);
    expect(save).toHaveTextContent('Not saved on this phone yet');
    expect(notifications()).toBeEmptyDOMElement();
  });

  it('has nothing to save on an empty phone', async () => {
    await renderSettings();
    const save = within(backupList()).getByRole('button', { name: /Save a backup file/ });
    await waitFor(() => {
      expect(save).toHaveTextContent('Nothing to back up yet');
    });
    expect(save).toBeDisabled();
  });
});

describe('Settings: export spreadsheet', () => {
  it('shares a CSV with one row per finished game', async () => {
    await seedDemoData({ today: '2026-09-28', liveGame: true });
    const share = stubFileSharing();
    const { user } = await renderSettings();

    await user.click(await enabledButton(/Export spreadsheet \(CSV\)/));

    const file = sharedFile(share);
    expect(file.name).toBe(`hoop-stats-games-${todayLocalISO()}.csv`);
    expect(file.type).toBe('text/csv');
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = (await file.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe(GAMES_CSV_HEADERS.join(','));
    // Ten final games; the live one is left out.
    expect(lines).toHaveLength(11);
    await expectToast('Spreadsheet saved');
  });

  it('downloads the CSV where files cannot be shared', async () => {
    await seedDemoData({ today: '2026-09-28' });
    const downloads = captureDownloads();
    const { user } = await renderSettings();

    await user.click(await enabledButton(/Export spreadsheet \(CSV\)/));

    expect(downloads.map((download) => download.name)).toEqual([
      `hoop-stats-games-${todayLocalISO()}.csv`,
    ]);
    await expectToast('Spreadsheet downloaded');
  });

  it('waits for a finished game', async () => {
    await createGame({ opponent: 'Lincoln', date: '2026-09-26', periodFormat: 'quarters' });
    await renderSettings();
    const csv = within(backupList()).getByRole('button', { name: /Export spreadsheet/ });
    expect(csv).toBeDisabled();
    expect(csv).toHaveTextContent('Available once a game is finished');
  });
});

describe('Settings: restore from a backup file', () => {
  it('previews the backup, then adds it to what is on the phone', async () => {
    const phoneGame = await seedPhoneGame();
    const { user } = await renderSettings();

    await chooseBackupFile(user, pickedFile(fixtureJson));

    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveAccessibleDescription(
      `Backup from ${formatDayWithYear(Date.parse('2026-09-20T12:00:00.000Z'))} · 2 games · Maya #7`,
    );
    await user.click(within(sheet).getByRole('button', { name: /Add to what's on this phone/ }));

    await expectToast('Restored 2 games');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Restore this backup?' })).toBeNull();
    });
    const games = await listGames();
    expect(games.map((game) => game.opponent).sort()).toEqual([
      'Brookside',
      'Hillcrest',
      'Lincoln',
    ]);
    expect(games.find((game) => game.id === phoneGame.id)).toBeDefined();
  });

  it('replaces everything on the phone after a confirmation', async () => {
    await seedPhoneGame();
    const { user } = await renderSettings();

    await chooseBackupFile(user, pickedFile(fixtureJson));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await user.click(
      within(sheet).getByRole('button', { name: /Replace everything on this phone/ }),
    );

    const confirm = screen.getByRole('alertdialog', { name: 'Replace everything on this phone?' });
    expect(confirm).toHaveAccessibleDescription(
      "The game on this phone and its stats will be erased and replaced with what's in the backup. This can't be undone.",
    );
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));

    await expectToast('Restored 2 games');
    expect((await listGames()).map((game) => game.opponent).sort()).toEqual([
      'Brookside',
      'Hillcrest',
    ]);
    expect(await getPlayer()).toMatchObject({ name: 'Maya', jerseyNumber: '7' });
  });

  it('changes nothing when the replacement is not confirmed', async () => {
    await seedPhoneGame();
    const { user } = await renderSettings();

    await chooseBackupFile(user, pickedFile(fixtureJson));
    await user.click(
      await screen.findByRole('button', { name: /Replace everything on this phone/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    // Back at the choice, with the phone's data untouched.
    expect(screen.getByRole('dialog', { name: 'Restore this backup?' })).toBeInTheDocument();
    expect((await listGames()).map((game) => game.opponent)).toEqual(['Lincoln']);
  });

  it('just restores on a phone with no games yet', async () => {
    const { user } = await renderSettings();

    await chooseBackupFile(user, pickedFile(fixtureJson));
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(sheet).toHaveTextContent(
      'There are no games on this phone yet, so nothing will be lost.',
    );
    expect(within(sheet).queryByRole('button', { name: /Replace everything/ })).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));

    await expectToast('Restored 2 games');
    expect(await listGames()).toHaveLength(2);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it("explains a file that isn't a backup, and changes nothing", async () => {
    await seedPhoneGame();
    const { user } = await renderSettings();

    await chooseBackupFile(user, pickedFile('{"hello":"world"}', 'notes.json'));

    const sheet = await screen.findByRole('dialog', { name: "Can't restore this file" });
    expect(sheet).toHaveAccessibleDescription("This file isn't a Hoop Stats backup.");
    await user.click(within(sheet).getByRole('button', { name: 'OK' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect((await listGames()).map((game) => game.opponent)).toEqual(['Lincoln']);
  });

  it('explains a backup from a newer version of the app', async () => {
    const { user } = await renderSettings();
    const newer = { ...(JSON.parse(fixtureJson) as object), schemaVersion: 99 };

    await chooseBackupFile(user, pickedFile(JSON.stringify(newer)));

    expect(
      await screen.findByRole('dialog', { name: "Can't restore this file" }),
    ).toHaveAccessibleDescription(
      'This backup is from a newer version of Hoop Stats. Update the app, then try again.',
    );
  });

  it('can restore the same file twice in a row', async () => {
    const { user } = await renderSettings();
    const file = pickedFile('not json at all');

    await chooseBackupFile(user, file);
    await user.click(await screen.findByRole('button', { name: 'OK' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    await chooseBackupFile(user, file);
    expect(await screen.findByRole('dialog', { name: "Can't restore this file" })).toBeVisible();
  });
});
