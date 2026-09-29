import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreStubs, stubProperties } from '@/test/browser';
import { buildDemoData } from '@/data/demo';
import { createGame, deleteGame, listGames, savePlayer, updateSettings } from '@/data/repo';
import { clearAllData, importAll } from '@/data/transfer';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import type * as RepoModule from '@/data/repo';
import type * as TransferModule from '@/data/transfer';
import fixtureJson from '../../../e2e/fixtures/settings-backup.json?raw';

// Failed writes must never fail silently: each one says so in a toast.

vi.mock('@/data/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof RepoModule>();
  return {
    ...actual,
    savePlayer: vi.fn(actual.savePlayer),
    updateSettings: vi.fn(actual.updateSettings),
    deleteGame: vi.fn(actual.deleteGame),
  };
});

vi.mock('@/data/transfer', async (importOriginal) => {
  const actual = await importOriginal<typeof TransferModule>();
  return {
    ...actual,
    importAll: vi.fn(actual.importAll),
    clearAllData: vi.fn(actual.clearAllData),
  };
});

const failure = () => new Error('The disk is full');
const notifications = () => screen.getByRole('status', { name: 'Notifications' });

async function expectToast(message: string) {
  await waitFor(() => {
    expect(notifications()).toHaveTextContent(message);
  });
}

async function renderSettings() {
  const view = renderRoute(paths.settings);
  await screen.findByRole('heading', { level: 2, name: 'Player' });
  return view;
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  restoreStubs();
});

describe('Settings when a write fails', () => {
  it('says a setting was not saved and shows the stored value', async () => {
    vi.mocked(updateSettings).mockRejectedValueOnce(failure());
    const { user } = await renderSettings();
    const toggle = screen.getByRole('switch', { name: 'Shot chart' });

    await user.click(toggle);

    await expectToast("Couldn't save that change. Try again.");
    expect(toggle).toBeChecked();
  });

  it('keeps the player sheet open, with what was typed', async () => {
    vi.mocked(savePlayer).mockRejectedValueOnce(failure());
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: /Add your player/ }));
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Maya');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await expectToast("Couldn't save. Try again.");
    expect(screen.getByRole('dialog', { name: 'Player' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Maya');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('says a restore changed nothing when it fails', async () => {
    await createGame({ opponent: 'Lincoln', date: '2026-09-26', periodFormat: 'quarters' });
    vi.mocked(importAll).mockRejectedValueOnce(failure());
    const { user } = await renderSettings();

    await user.upload(
      screen.getByLabelText('Backup file to restore'),
      new File([fixtureJson], 'hoop-stats-backup-2026-09-20.json', { type: 'application/json' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    await user.click(within(sheet).getByRole('button', { name: /Add to what's on this phone/ }));

    await expectToast("Couldn't restore the backup. Nothing on this phone was changed.");
    expect(sheet).toBeInTheDocument();
    expect((await listGames()).map((game) => game.opponent)).toEqual(['Lincoln']);
  });

  it('says so when the sample data cannot be added', async () => {
    vi.mocked(importAll).mockRejectedValueOnce(failure());
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: /Try it with sample data/ }));

    await expectToast("Couldn't add the sample games. Try again.");
    expect(screen.getByRole('button', { name: /Try it with sample data/ })).toBeEnabled();
  });

  it('says so when the sample games cannot be removed', async () => {
    await importAll(buildDemoData({ today: '2026-09-28' }), 'replace');
    vi.mocked(deleteGame).mockRejectedValueOnce(failure());
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: /Remove sample games/ }));

    await expectToast("Couldn't remove the sample games. Try again.");
    expect(screen.getByRole('button', { name: /Remove sample games/ })).toBeEnabled();
    expect(await listGames()).toHaveLength(10);
  });

  it('says so when erasing fails', async () => {
    await importAll(buildDemoData({ today: '2026-09-28' }), 'replace');
    vi.mocked(clearAllData).mockRejectedValueOnce(failure());
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Erase all data' }),
    );

    await expectToast("Couldn't erase the data. Try again.");
    expect(await listGames()).toHaveLength(10);
  });

  it('says so when the backup file can be neither shared nor downloaded', async () => {
    await importAll(buildDemoData({ today: '2026-09-28' }), 'replace');
    stubProperties(URL, {
      createObjectURL: () => {
        throw new Error('No object URLs here');
      },
    });
    const { user } = await renderSettings();
    const save = screen.getByRole('button', { name: /Save a backup file/ });
    await waitFor(() => {
      expect(save).toBeEnabled();
    });

    await user.click(save);

    await expectToast("Couldn't save the file. Try again.");
    expect(save).toHaveTextContent('Not saved on this phone yet');
  });
});
