import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreStubs, simulateBrowser, stubProperties } from '@/components/InstallBanner/testing';
import { seedDemoData } from '@/data/demo';
import {
  createGame,
  deleteGame,
  getPlayer,
  getSettings,
  listGames,
  savePlayer,
  updateSettings,
} from '@/data/repo';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import { APP_VERSION } from './appVersion';

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

/** Waits for a toast. (Re-queried: the toast area moves into a sheet while one is open.) */
async function expectToast(message: string) {
  await waitFor(() => {
    expect(notifications()).toHaveTextContent(message);
  });
}

/** Renders Settings and waits for its data to load. */
async function renderSettings() {
  const view = renderRoute(paths.settings);
  await screen.findByRole('heading', { level: 2, name: 'Player' });
  return view;
}

function list(name: string) {
  return screen.getByRole('list', { name });
}

afterEach(() => {
  restoreStubs();
  localStorage.clear();
});

describe('Settings: player', () => {
  it('edits the name and clears the jersey number', async () => {
    await savePlayer({ name: 'Ava', jerseyNumber: '12' });
    const { user } = await renderSettings();

    const row = await within(list('Player')).findByRole('button', { name: /Ava/ });
    expect(row).toHaveTextContent('Jersey #12');
    await user.click(row);

    const sheet = screen.getByRole('dialog', { name: 'Player' });
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    const jersey = within(sheet).getByRole('textbox', { name: 'Jersey number' });
    expect(name).toHaveValue('Ava');
    expect(jersey).toHaveValue('12');
    // Opens on the title, not a field, so the keyboard doesn't cover the sheet.
    expect(name).not.toHaveFocus();

    await user.clear(name);
    await user.type(name, '  Ava Grace ');
    await user.clear(jersey);
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Player' })).not.toBeInTheDocument();
    });
    expect(await getPlayer()).toMatchObject({ name: 'Ava Grace' });
    expect((await getPlayer())?.jerseyNumber).toBeUndefined();
    expect(
      await within(list('Player')).findByRole('button', { name: /Ava Grace/ }),
    ).toHaveTextContent('No jersey number');
  });

  it('sets up the player the first time', async () => {
    const { user } = await renderSettings();

    await user.click(within(list('Player')).getByRole('button', { name: /Add your player/ }));
    const sheet = screen.getByRole('dialog', { name: 'Player' });
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.type(name, 'Maya');
    // The keyboard's "next" key moves to the jersey number instead of saving.
    await user.keyboard('{Enter}');
    const jersey = within(sheet).getByRole('textbox', { name: 'Jersey number' });
    expect(jersey).toHaveFocus();
    expect(await getPlayer()).toBeUndefined();
    await user.type(jersey, '7{Enter}');

    await waitFor(async () => {
      expect(await getPlayer()).toMatchObject({ name: 'Maya', jerseyNumber: '7' });
    });
    expect(await within(list('Player')).findByRole('button', { name: /Maya/ })).toHaveTextContent(
      'Jersey #7',
    );
  });

  it('asks for a name instead of saving an empty one', async () => {
    await savePlayer({ name: 'Ava', jerseyNumber: '12' });
    const { user } = await renderSettings();
    await user.click(await within(list('Player')).findByRole('button', { name: /Ava/ }));

    const sheet = screen.getByRole('dialog', { name: 'Player' });
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    expect(name).toHaveAccessibleDescription('Enter a name');
    expect(name).toBeInvalid();
    expect(sheet).toBeInTheDocument();
    expect(await getPlayer()).toMatchObject({ name: 'Ava', jerseyNumber: '12' });
  });

  it('keeps the saved details when cancelled, and starts fresh next time', async () => {
    await savePlayer({ name: 'Ava', jerseyNumber: '12' });
    const { user } = await renderSettings();
    const row = await within(list('Player')).findByRole('button', { name: /Ava/ });

    await user.click(row);
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.type(name, 'bel');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Player' })).not.toBeInTheDocument();
    });
    expect(await getPlayer()).toMatchObject({ name: 'Ava' });

    await user.click(row);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Ava');
  });
});

describe('Settings: game setup', () => {
  it('turns the shot chart off and on, saving each change', async () => {
    const { user, unmount } = await renderSettings();
    const toggle = screen.getByRole('switch', { name: 'Shot chart' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription('Tap the court to mark where each shot was taken');

    await user.click(toggle);
    await waitFor(async () => {
      expect((await getSettings()).shotChart).toBe(false);
    });
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });

    unmount();
    await renderSettings();
    expect(screen.getByRole('switch', { name: 'Shot chart' })).not.toBeChecked();
  });

  it('saves the default periods for new games', async () => {
    const { user, unmount } = await renderSettings();
    const periods = screen.getByRole('radiogroup', { name: 'Periods' });
    expect(within(periods).getByRole('radio', { name: 'Quarters' })).toBeChecked();

    await user.click(within(periods).getByRole('radio', { name: 'Halves' }));
    await waitFor(async () => {
      expect((await getSettings()).defaultPeriodFormat).toBe('halves');
    });

    unmount();
    await renderSettings();
    expect(screen.getByRole('radio', { name: 'Halves' })).toBeChecked();
  });
});

describe('Settings: storage', () => {
  it('reports protected storage and the space used', async () => {
    stubProperties(navigator, {
      storage: {
        persisted: () => Promise.resolve(true),
        estimate: () => Promise.resolve({ usage: 1_234_567, quota: 10_000_000_000 }),
      },
    });
    await renderSettings();
    const storage = list('Storage');

    expect(await within(storage).findByText('Yes')).toBeInTheDocument();
    expect(storage).toHaveTextContent('Space used1.2 MB');
    expect(screen.getByText("This browser won't clear your stats to free up space.")).toBeVisible();
  });

  it('suggests the Home Screen when storage may be cleared', async () => {
    stubProperties(navigator, {
      storage: { persisted: () => Promise.resolve(false) },
    });
    await renderSettings();

    expect(await within(list('Storage')).findByText('No')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Safari can clear website data. Add Hoop Stats to your Home Screen to keep your stats safe.',
      ),
    ).toBeInTheDocument();
    expect(list('Storage')).not.toHaveTextContent('Space used');
  });

  it("says Unknown when the browser can't tell", async () => {
    await renderSettings();
    expect(await within(list('Storage')).findByText('Unknown')).toBeInTheDocument();
  });
});

describe('Settings: Add to Home Screen', () => {
  it('explains how to add the app when it runs in a browser tab', async () => {
    const { user } = await renderSettings();

    await user.click(
      within(list('Home Screen')).getByRole('button', { name: 'Add to Home Screen' }),
    );

    const sheet = screen.getByRole('dialog', { name: 'Add to Home Screen' });
    expect(within(sheet).getByRole('list', { name: 'In Safari' })).toHaveTextContent(
      'Tap the Share button',
    );
    expect(sheet).toHaveTextContent('Works offline');
    expect(sheet).toHaveTextContent('Keeps your stats safe');
  });

  it('is left out in the Home Screen app', async () => {
    simulateBrowser({ displayModeStandalone: true });
    await renderSettings();
    expect(screen.queryByRole('list', { name: 'Home Screen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to Home Screen' })).not.toBeInTheDocument();
  });
});

describe('Settings: about', () => {
  it('shows the app version', async () => {
    await renderSettings();
    expect(list('About')).toHaveTextContent(`Version${APP_VERSION}`);
  });

  it('offers sample data on an empty phone, keeping its Game setup', async () => {
    const settings = await updateSettings({ shotChart: false, defaultPeriodFormat: 'halves' });
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: /Try it with sample data/ }));

    await expectToast('Sample games added');
    expect(await listGames()).toHaveLength(10);
    expect(await getSettings()).toEqual(settings);
    // Offered only while the phone is empty.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Try it with sample data/ })).toBeNull();
    });
  });

  it('offers sample data after a test game was started and deleted', async () => {
    // Starting a game before setting up the player creates an unnamed player.
    const game = await createGame({
      opponent: 'Test',
      date: '2026-09-28',
      periodFormat: 'quarters',
    });
    await deleteGame(game.id);
    expect(await getPlayer()).toMatchObject({ name: '' });
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: /Try it with sample data/ }));

    await expectToast('Sample games added');
    expect(await listGames()).toHaveLength(10);
    expect(await getPlayer()).toMatchObject({ name: 'Ava', jerseyNumber: '12' });
  });

  it('removes just the sample games', async () => {
    await seedDemoData({ today: '2026-09-28' });
    const own = await createGame({
      opponent: 'Hillcrest',
      date: '2026-09-28',
      periodFormat: 'halves',
    });
    const settings = await getSettings();
    const { user } = await renderSettings();

    const remove = screen.getByRole('button', { name: /Remove sample games/ });
    expect(remove).toHaveTextContent(
      'Deletes just the 10 sample games. The player, your settings and any games of your own stay.',
    );
    await user.click(remove);

    await expectToast('Sample games removed');
    expect((await listGames()).map((game) => game.id)).toEqual([own.id]);
    expect(await getPlayer()).toMatchObject({ name: 'Ava', jerseyNumber: '12' });
    expect(await getSettings()).toEqual(settings);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Remove sample games/ })).toBeNull();
    });
  });

  it('leads from the sample data to the games', async () => {
    const { user, router } = await renderSettings();

    await user.click(screen.getByRole('button', { name: /Try it with sample data/ }));
    await expectToast('Sample games added');
    await user.click(within(notifications()).getByRole('button', { name: 'See games' }));

    expect(router.state.location.pathname).toBe(paths.home);
  });

  it('offers no sample data once there are games or a named player', async () => {
    await createGame({ opponent: 'Lincoln', date: '2026-09-20', periodFormat: 'quarters' });
    const { unmount } = await renderSettings();
    expect(screen.queryByRole('button', { name: /Try it with sample data/ })).toBeNull();
    unmount();

    for (const game of await listGames()) await deleteGame(game.id);
    await savePlayer({ name: 'Maya' });
    await renderSettings();
    expect(screen.queryByRole('button', { name: /Try it with sample data/ })).toBeNull();
  });

  it('erases everything after an explicit confirmation', async () => {
    await seedDemoData({ today: '2026-09-28' });
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Erase all data?' });
    expect(dialog).toHaveAccessibleDescription(
      "All 10 games and their stats, the player's name and number, and your settings will be deleted from this phone. This can't be undone. If you might want them back, save a backup file first.",
    );
    // Starts on the safe choice.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(within(dialog).getByRole('button', { name: 'Erase all data' }));

    await expectToast('All data erased');
    expect(await listGames()).toEqual([]);
    expect(await getPlayer()).toBeUndefined();
    expect(await screen.findByRole('button', { name: /Try it with sample data/ })).toBeVisible();
    expect(within(list('Player')).getByRole('button', { name: /Add your player/ })).toBeVisible();
  });

  it('erases nothing when cancelled', async () => {
    await seedDemoData({ today: '2026-09-28' });
    const { user } = await renderSettings();

    await user.click(screen.getByRole('button', { name: 'Erase all data' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(await listGames()).toHaveLength(10);
  });
});
