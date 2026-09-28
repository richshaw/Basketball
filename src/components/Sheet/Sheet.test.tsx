import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import { Sheet, type SheetProps } from './Sheet';

type DemoProps = Partial<Omit<SheetProps, 'open' | 'onClose'>> & {
  /** Called on every close request; the demo also closes unless `keepOpen`. */
  onClose?: () => void;
  keepOpen?: boolean;
};

/** A trigger button and a controlled Sheet, like a screen would use them. */
function SheetDemo({ onClose, keepOpen = false, title = 'Edit game', ...props }: DemoProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Edit</Button>
      <Sheet
        title={title}
        {...props}
        open={open}
        onClose={() => {
          onClose?.();
          if (!keepOpen) setOpen(false);
        }}
      />
    </>
  );
}

async function openDemo(props: DemoProps = {}) {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<SheetDemo onClose={onClose} {...props} />);
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = screen.getByRole('dialog', { name: props.title ?? 'Edit game' });
  return { user, onClose, dialog: dialog as HTMLDialogElement };
}

const waitForClosed = () =>
  waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

describe('Sheet', () => {
  it('renders nothing while closed', () => {
    render(<Sheet open={false} onClose={() => {}} title="Edit game" />);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('opens as a modal dialog named by its title and described by its description', async () => {
    const { dialog } = await openDemo({ description: 'Changes save right away.' });
    expect(dialog.open).toBe(true);
    expect(dialog).toHaveAccessibleDescription('Changes save right away.');
    expect(screen.getByRole('heading', { level: 2, name: 'Edit game' })).toBeInTheDocument();
  });

  it('moves focus into the sheet, to the close button', async () => {
    await openDemo();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    // Chrome starts on any focusable element, so the title must not be one here.
    expect(screen.getByRole('heading', { name: 'Edit game' })).not.toHaveAttribute('tabindex');
  });

  it('focuses the initial focus element when given one', async () => {
    const user = userEvent.setup();
    function WithInitialFocus() {
      const [open, setOpen] = useState(false);
      const saveRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Edit</Button>
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            title="Edit game"
            initialFocusRef={saveRef}
            footer={<Button ref={saveRef}>Save</Button>}
          />
        </>
      );
    }
    render(<WithInitialFocus />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('starts on the title, not a text field, when there is no close button', async () => {
    // Focusing a field would pop up the iPhone keyboard as the sheet opens.
    await openDemo({ dismissible: false, children: <TextField label="Our score" /> });
    expect(screen.getByRole('heading', { name: 'Edit game' })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Edit game' })).not.toHaveAttribute('autofocus');
  });

  it('renders its content and pinned footer', async () => {
    await openDemo({
      children: <p>Opponent and date</p>,
      footer: <Button>Save</Button>,
    });
    expect(screen.getByText('Opponent and date').parentElement).toHaveClass('body');
    expect(screen.getByRole('button', { name: 'Save' }).parentElement).toHaveClass('footer');
  });

  it('closes with the close button and returns focus to the trigger', async () => {
    const { user, onClose } = await openDemo();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await waitForClosed();
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
  });

  it('asks to close on Escape but leaves the decision to the open prop', async () => {
    const { user, onClose, dialog } = await openDemo({ keepOpen: true });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    // The parent kept it open, so the browser's own close was prevented.
    expect(dialog.open).toBe(true);
  });

  it('closes on Escape when the parent agrees', async () => {
    const { user } = await openDemo();
    await user.keyboard('{Escape}');
    await waitForClosed();
  });

  it('closes when the dimmed page is tapped, but not when the panel is', async () => {
    const { user, onClose, dialog } = await openDemo({ children: <p>Opponent and date</p> });
    await user.click(screen.getByText('Opponent and date'));
    expect(onClose).not.toHaveBeenCalled();

    // A press that starts in the panel and ends outside it (e.g. selecting text) doesn't count.
    fireEvent.pointerDown(screen.getByText('Opponent and date'));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitForClosed();
  });

  it('ignores the dimmed page, Escape and has no close button when not dismissible', async () => {
    const { user, onClose, dialog } = await openDemo({
      dismissible: false,
      footer: <Button>Save</Button>,
    });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

    await user.click(dialog);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it('can hide the close button', async () => {
    await openDemo({ hideCloseButton: true });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('labels the close button with closeLabel', async () => {
    await openDemo({ closeLabel: 'Done' });
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('can be an alertdialog', () => {
    render(
      <Sheet open onClose={() => {}} title="Delete this game?" role="alertdialog">
        <p>Its stats will be gone for good.</p>
      </Sheet>,
    );
    expect(screen.getByRole('alertdialog', { name: 'Delete this game?' })).toBeInTheDocument();
  });

  it('locks page scrolling while any sheet is open', async () => {
    const root = document.documentElement;
    function TwoSheets({ first, second }: { first: boolean; second: boolean }) {
      return (
        <>
          <Sheet open={first} onClose={() => {}} title="First" />
          <Sheet open={second} onClose={() => {}} title="Second" />
        </>
      );
    }
    const { rerender } = render(<TwoSheets first={false} second={false} />);
    expect(root.style.overflow).toBe('');

    rerender(<TwoSheets first second={false} />);
    expect(root.style.overflow).toBe('hidden');
    rerender(<TwoSheets first second />);
    rerender(<TwoSheets first={false} second />);
    expect(root.style.overflow).toBe('hidden');

    rerender(<TwoSheets first={false} second={false} />);
    expect(root.style.overflow).toBe('');
    await waitForClosed();
  });

  it('unlocks page scrolling when unmounted while open', () => {
    const { unmount } = render(<Sheet open onClose={() => {}} title="Edit game" />);
    expect(document.documentElement.style.overflow).toBe('hidden');
    unmount();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('reports a close made by the browser itself, then follows the open prop', async () => {
    const { onClose, dialog } = await openDemo();
    // e.g. Chrome closes a modal on a second Escape even when "cancel" is prevented.
    act(() => dialog.close());
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitForClosed();
  });

  it('shows itself again if the browser closes it while it must stay open', async () => {
    const { onClose, dialog } = await openDemo({ dismissible: false });
    act(() => dialog.close());
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(dialog.open).toBe(true);
    });
  });
});

describe('Sheet in a tall layout', () => {
  it('keeps long content in the scrollable body', async () => {
    const rows: ReactNode[] = Array.from({ length: 40 }, (_, index) => (
      <p key={index}>Row {index + 1}</p>
    ));
    await openDemo({ children: rows, footer: <Button>Done</Button> });
    expect(screen.getByText('Row 40').parentElement).toHaveClass('body');
    expect(screen.getByRole('button', { name: 'Done' }).parentElement).toHaveClass('footer');
  });
});
