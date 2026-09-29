import { screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGames } from '@/data/repo';
import { importAll, parseExportFile } from '@/data/transfer';
import { renderWithRouter } from '@/test/render';
import fixtureJson from '../../../e2e/fixtures/settings-backup.json?raw';
import { RestoreSheet, type RestoreRequest, type RestoreSheetProps } from './RestoreSheet';
import type * as TransferModule from '@/data/transfer';

// importAll as usual, but a test can hold it back (see holdImport).
vi.mock('@/data/transfer', async (importOriginal) => {
  const actual = await importOriginal<typeof TransferModule>();
  return { ...actual, importAll: vi.fn(actual.importAll) };
});

/** The next restore waits until `release()`, then imports as usual. */
function holdImport() {
  const actual = vi.mocked(importAll).getMockImplementation();
  let release = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(importAll).mockImplementationOnce(async (...args) => {
    await released;
    if (!actual) throw new Error('No importAll');
    return actual(...args);
  });
  return release;
}

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

/** Two games of "Maya" #7, for a phone with none (so the sheet just restores). */
const request: RestoreRequest = {
  kind: 'preview',
  backup: parseExportFile(fixtureJson),
  phoneGameIds: [],
};

/** The sheet as a screen shows it: open until closed, and gone once the screen is left. */
function Screen(props: Pick<RestoreSheetProps, 'afterRestore' | 'onRestored'>) {
  const [open, setOpen] = useState(true);
  const [left, setLeft] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setLeft(true)}>
        Leave
      </button>
      {left ? null : (
        <RestoreSheet open={open} request={request} onClose={() => setOpen(false)} {...props} />
      )}
    </>
  );
}

afterEach(() => {
  vi.mocked(importAll).mockReset();
});

describe('RestoreSheet', () => {
  it('adds what the step after the restore says, then hands over', async () => {
    const onRestored = vi.fn();
    const { user } = renderWithRouter(
      <Screen afterRestore={() => 'Cloud backup is on.'} onRestored={onRestored} />,
    );

    await user.click(screen.getByRole('button', { name: 'Restore backup' }));

    await waitFor(() => {
      expect(notifications()).toHaveTextContent('Restored 2 games. Cloud backup is on.');
    });
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(await listGames()).toHaveLength(2);
  });

  it('still says what was restored when the step after it throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onRestored = vi.fn();
    const { user } = renderWithRouter(
      <Screen
        afterRestore={() => {
          throw new Error('Storage failed');
        }}
        onRestored={onRestored}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Restore backup' }));

    await waitFor(() => {
      expect(notifications()).toHaveTextContent('Restored 2 games');
    });
    expect(notifications()).not.toHaveTextContent('Storage failed');
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    expect(await listGames()).toHaveLength(2);
  });

  it("says so but doesn't hand over when the parent closed it while it restored", async () => {
    const release = holdImport();
    const onRestored = vi.fn();
    const { user } = renderWithRouter(<Screen onRestored={onRestored} />);
    const sheet = screen.getByRole('dialog', { name: 'Restore this backup?' });

    await user.click(within(sheet).getByRole('button', { name: 'Restore backup' }));
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    release();

    await waitFor(() => {
      expect(notifications()).toHaveTextContent('Restored 2 games');
    });
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('says nothing once its screen has gone', async () => {
    const release = holdImport();
    const onRestored = vi.fn();
    const { user } = renderWithRouter(<Screen onRestored={onRestored} />);

    await user.click(screen.getByRole('button', { name: 'Restore backup' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    release();

    // The stats are restored all the same, quietly.
    await waitFor(async () => {
      expect(await listGames()).toHaveLength(2);
    });
    expect(notifications()).toBeEmptyDOMElement();
    expect(onRestored).not.toHaveBeenCalled();
  });
});
