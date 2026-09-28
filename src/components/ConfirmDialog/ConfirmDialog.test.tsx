import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/Button/Button';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
import { useConfirm, type ConfirmOptions } from './confirmContext';
import { ConfirmProvider } from './ConfirmProvider';

function renderDialog(props: Partial<ConfirmDialogProps> = {}) {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const title = props.title ?? 'Delete this game?';
  render(
    <ConfirmDialog
      open
      message="Its stats will be gone for good."
      confirmLabel="Delete game"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
      title={title}
    />,
  );
  const dialog = screen.getByRole('alertdialog', { name: title });
  return { user, onConfirm, onCancel, dialog };
}

describe('ConfirmDialog', () => {
  it('asks the question as an alertdialog with the message as its description', () => {
    const { dialog } = renderDialog();
    expect(dialog).toHaveAccessibleDescription('Its stats will be gone for good.');
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('confirms', async () => {
    const { user, onConfirm, onCancel } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Delete game' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('cancels with the cancel button, Escape or a tap on the dimmed page', async () => {
    const { user, onConfirm, onCancel, dialog } = renderDialog({ cancelLabel: 'Keep it' });
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    await user.keyboard('{Escape}');
    await user.click(dialog);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses a red confirm button and starts on Cancel when destructive', () => {
    renderDialog({ destructive: true });
    expect(screen.getByRole('button', { name: 'Delete game' })).toHaveClass('danger');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('uses a primary confirm button and starts on it otherwise', () => {
    renderDialog({ title: 'End the game?', confirmLabel: 'End game' });
    expect(screen.getByRole('button', { name: 'End game' })).toHaveClass('primary');
    expect(screen.getByRole('button', { name: 'End game' })).toHaveFocus();
  });

  it('defaults the button labels', () => {
    renderDialog({ confirmLabel: undefined });
    expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

/** A button that asks via useConfirm() and prints the answer. */
function AskButton({ options }: { options: ConfirmOptions }) {
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('none');
  return (
    <>
      <Button
        onClick={async () => {
          setAnswer(String(await confirm(options)));
        }}
      >
        Delete
      </Button>
      <p>Answer: {answer}</p>
    </>
  );
}

const deleteGame: ConfirmOptions = {
  title: 'Delete this game?',
  message: 'Its stats will be gone for good.',
  confirmLabel: 'Delete game',
  destructive: true,
};

function renderWithProvider() {
  const user = userEvent.setup();
  render(
    <ConfirmProvider>
      <AskButton options={deleteGame} />
    </ConfirmProvider>,
  );
  return { user };
}

describe('useConfirm', () => {
  it('resolves to true when confirmed and closes the dialog', async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete this game?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete game' }));
    expect(await screen.findByText('Answer: true')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('resolves to false when cancelled', async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Answer: false')).toBeInTheDocument();
  });

  it('resolves to false when dismissed with Escape', async () => {
    const { user } = renderWithProvider();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Answer: false')).toBeInTheDocument();
  });

  it('cancels an unanswered question when a new one is asked', async () => {
    const answers: boolean[] = [];
    function AskTwice() {
      const confirm = useConfirm();
      return (
        <Button
          onClick={() => {
            void confirm({ title: 'First?' }).then((answer) => answers.push(answer));
            void confirm({ title: 'Second?' }).then((answer) => answers.push(answer));
          }}
        >
          Ask
        </Button>
      );
    }
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <AskTwice />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByRole('alertdialog', { name: 'Second?' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog', { name: 'First?' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'OK' }));
    await waitFor(() => {
      expect(answers).toEqual([false, true]);
    });
  });

  it('opens a follow-up question only after the first dialog has closed, from scratch', async () => {
    const answers: boolean[] = [];
    function EndThenDelete() {
      const confirm = useConfirm();
      return (
        <Button
          onClick={async () => {
            answers.push(await confirm({ title: 'End the game?', confirmLabel: 'End game' }));
            answers.push(await confirm(deleteGame));
          }}
        >
          Finish
        </Button>
      );
    }
    const user = userEvent.setup();
    render(
      <ConfirmProvider>
        <EndThenDelete />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Finish' }));
    const first = screen.getByRole('alertdialog', { name: 'End the game?' });
    expect(screen.getByRole('button', { name: 'End game' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'End game' }));
    const second = await screen.findByRole('alertdialog', { name: 'Delete this game?' });
    // A new dialog, not the first one with new words: focus starts on the safe button,
    // so a double tap on "End game" can't also delete the game.
    expect(second).not.toBe(first);
    expect(first).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(answers).toEqual([true, false]);
    });
  });

  it('explains a missing provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<AskButton options={deleteGame} />)).toThrow(/ConfirmProvider/);
  });
});
