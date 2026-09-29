import { screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

// The gallery loads on demand; load its module once up front so each render is quick.
beforeAll(async () => {
  await import('./DevUiScreen');
});

async function openGallery() {
  const view = renderRoute(paths.devUi);
  await screen.findByRole('heading', { level: 1, name: 'UI kit' });
  return view;
}

describe('DevUiScreen', () => {
  it('shows a section for each shared component', async () => {
    await openGallery();
    for (const title of [
      'SegmentedControl',
      'TextField and TextArea',
      'GroupedList and ListRow',
      'StatTable',
      'StatTile and StatTileGrid',
      'Badge',
      'Sheet and ConfirmDialog',
      'Toast and shareText',
      'InstallBanner and InstallSheet',
      'BackupBanner',
      'Button',
      'Court',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it('opens a game from a tap anywhere on a game log row (linkedRows)', async () => {
    const { user, router } = await openGallery();
    const log = screen.getByRole('table', { name: 'Game log' });
    const row = within(log).getByRole('row', { name: /Hawks/ });
    await user.click(within(row).getByRole('cell', { name: '9' }));
    expect(router.state.location.pathname).toBe(paths.gameReport('demo'));
  });

  it('opens a sheet whose Save closes it and shows a toast', async () => {
    const { user } = await openGallery();
    await user.click(screen.getByRole('button', { name: 'Edit game' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit game' });

    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(notifications()).toHaveTextContent('Game saved');
  });

  it('asks before deleting and reports the answer', async () => {
    const { user } = await openGallery();
    await user.click(screen.getByRole('button', { name: 'Delete game' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this game?' });

    await user.click(within(dialog).getByRole('button', { name: 'Delete game' }));
    expect(await screen.findByText('Last answer: deleted')).toBeInTheDocument();
    expect(notifications()).toHaveTextContent('Game deleted');
  });

  it('confirms inside a sheet without closing the sheet on Cancel', async () => {
    const { user } = await openGallery();
    await user.click(screen.getByRole('button', { name: 'Edit game' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit game' });

    await user.click(within(sheet).getByRole('button', { name: 'Delete…' }));
    const confirmDelete = () => screen.getByRole('alertdialog', { name: 'Delete this game?' });
    await user.click(within(confirmDelete()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(sheet).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Delete…' }));
    await user.click(within(confirmDelete()).getByRole('button', { name: 'Delete game' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(notifications()).toHaveTextContent('Game deleted');
  });

  it('shows the install banner, whose How opens the steps', async () => {
    const { user } = await openGallery();
    const banner = screen.getByRole('complementary', { name: 'Add to Home Screen' });

    await user.click(within(banner).getByRole('button', { name: 'How' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Add to Home Screen' })).getByRole('list', {
        name: 'In Safari',
      }),
    ).toHaveTextContent('Tap the Share button');
  });

  it('shows an undo toast whose action runs once', async () => {
    const { user } = await openGallery();
    await user.click(screen.getByRole('button', { name: '2PT made' }));
    await user.click(within(notifications()).getByRole('button', { name: 'Undo' }));
    expect(screen.getByText('Undos: 1')).toBeInTheDocument();
    expect(await within(notifications()).findByText('Undone: 2PT made')).toBeInTheDocument();
  });
});
