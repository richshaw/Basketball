import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

describe('DevUiScreen', () => {
  it('shows a section for each shared component', () => {
    renderRoute(paths.devUi);
    for (const title of [
      'SegmentedControl',
      'TextField and TextArea',
      'GroupedList and ListRow',
      'StatTable',
      'StatTile and StatTileGrid',
      'Badge',
      'Sheet and ConfirmDialog',
      'Toast and shareText',
      'Button',
      'Court',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    }
  });

  it('opens a sheet whose Save closes it and shows a toast', async () => {
    const { user } = renderRoute(paths.devUi);
    await user.click(screen.getByRole('button', { name: 'Edit game' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit game' });

    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(notifications()).toHaveTextContent('Game saved');
  });

  it('asks before deleting and reports the answer', async () => {
    const { user } = renderRoute(paths.devUi);
    await user.click(screen.getByRole('button', { name: 'Delete game' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this game?' });

    await user.click(within(dialog).getByRole('button', { name: 'Delete game' }));
    expect(await screen.findByText('Last answer: deleted')).toBeInTheDocument();
    expect(notifications()).toHaveTextContent('Game deleted');
  });

  it('shows an undo toast', async () => {
    const { user } = renderRoute(paths.devUi);
    await user.click(screen.getByRole('button', { name: '2PT made' }));
    await user.click(within(notifications()).getByRole('button', { name: 'Undo' }));
    expect(notifications()).toHaveTextContent('Undone: 2PT made');
  });
});
