import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/Button/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { TextField } from '@/components/TextField/TextField';
import { restoreStubs, stubProperties } from '@/test/browser';
import { Sheet, type SheetProps } from './Sheet';
import sheetCss from './Sheet.module.css?raw';

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
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await waitForClosed();
  });

  it('shows itself again if the browser closes it while it must stay open', async () => {
    const { onClose, dialog } = await openDemo({ dismissible: false });
    act(() => dialog.close());
    await waitFor(() => {
      expect(dialog.open).toBe(true);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a queued close event that arrives after it was opened again', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Sheet open onClose={onClose} title="Edit game" />);
    const dialog = screen.getByRole<HTMLDialogElement>('dialog');

    // Closing queues a "close" event; reopening at once must not be undone by it.
    rerender(<Sheet open={false} onClose={onClose} title="Edit game" />);
    rerender(<Sheet open onClose={onClose} title="Edit game" />);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it('gives the page back as soon as closing starts, then reports when it is gone', async () => {
    const onClosed = vi.fn();
    const { dialog } = await openDemo({ onClosed, footer: <Button>Save</Button> });
    const trigger = screen.getByRole('button', { name: 'Edit' });
    expect(trigger).toHaveAttribute('inert');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    });
    // Still on screen for its exit animation, but already closed: focus is back and
    // the page is usable, while the sheet's own buttons can't be tapped again.
    expect(dialog).toHaveAttribute('data-closing');
    expect(dialog.open).toBe(false);
    expect(trigger).toHaveFocus();
    expect(trigger).not.toHaveAttribute('inert');
    expect(screen.getByText('Save', { selector: 'button' }).parentElement).toHaveAttribute('inert');
    expect(onClosed).not.toHaveBeenCalled();

    await waitForClosed();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('lifts itself above the on-screen keyboard', async () => {
    const keyboard = new (class extends EventTarget {
      height = 461;
      offsetTop = 0;
      scale = 1;
    })();
    vi.stubGlobal('visualViewport', keyboard);
    vi.stubGlobal('innerHeight', 797);
    try {
      const { dialog } = await openDemo();
      expect(dialog.style.getPropertyValue('--keyboard-inset')).toBe('336px');

      act(() => {
        keyboard.height = 797;
        keyboard.dispatchEvent(new Event('resize'));
      });
      expect(dialog.style.getPropertyValue('--keyboard-inset')).toBe('0px');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('Sheet with a dialog inside it', () => {
  /** An edit sheet whose content opens a ConfirmDialog, like "Delete this game?". */
  function EditWithConfirm({ onSheetClose }: { onSheetClose: () => void }) {
    const [confirming, setConfirming] = useState(false);
    return (
      <Sheet open onClose={onSheetClose} title="Edit game">
        <TextField label="Opponent" />
        <Button onClick={() => setConfirming(true)}>Delete</Button>
        <ConfirmDialog
          open={confirming}
          title="Delete this game?"
          confirmLabel="Delete game"
          destructive
          onConfirm={() => setConfirming(false)}
          onCancel={() => setConfirming(false)}
        />
      </Sheet>
    );
  }

  async function openBoth() {
    const user = userEvent.setup();
    const onSheetClose = vi.fn();
    render(<EditWithConfirm onSheetClose={onSheetClose} />);
    await user.type(screen.getByRole('textbox', { name: 'Opponent' }), 'Hawks');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog', { name: 'Delete this game?' })).toBeInTheDocument();
    return { user, onSheetClose };
  }

  const expectOnlyTheSheetLeft = async (onSheetClose: () => void) => {
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    // React passes a nested dialog's cancel/close events up to the sheet: it must ignore them.
    expect(onSheetClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Edit game' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Opponent' })).toHaveValue('Hawks');
  };

  it('closes only the inner dialog on Escape', async () => {
    const { user, onSheetClose } = await openBoth();
    await user.keyboard('{Escape}');
    await expectOnlyTheSheetLeft(onSheetClose);
  });

  it('closes only the inner dialog with its buttons', async () => {
    const { user, onSheetClose } = await openBoth();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expectOnlyTheSheetLeft(onSheetClose);
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

describe('Sheet sliding away', () => {
  let removeStyles = () => {};

  beforeEach(() => {
    // Its real styles (tests stub CSS otherwise), so a tap meets what it would on a phone.
    const style = document.createElement('style');
    style.textContent = sheetCss;
    document.head.append(style);
    removeStyles = () => style.remove();
  });

  afterEach(() => {
    removeStyles();
    restoreStubs();
  });

  /** Keeps the exit animation running (jsdom has none) until the returned function ends it. */
  function holdExitAnimation(): () => void {
    let end = () => {};
    const finished = new Promise<void>((resolve) => {
      end = resolve;
    });
    const exit = { effect: { getTiming: () => ({ iterations: 1 }) }, finished };
    stubProperties(Element.prototype, { getAnimations: () => [exit] });
    return end;
  }

  it('takes no taps once it starts closing, so the next one reaches the page', async () => {
    const endExit = holdExitAnimation();
    const onAssist = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Button onClick={onAssist}>Assist</Button>
        <SheetDemo footer={<Button>Save</Button>} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit game' });
    expect(getComputedStyle(dialog).pointerEvents).not.toBe('none');

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    // Still on screen, sliding away: neither the dimmed page nor the panel takes a tap...
    expect(dialog).toHaveAttribute('data-closing');
    expect(getComputedStyle(dialog).pointerEvents).toBe('none');
    await expect(user.click(dialog)).rejects.toThrow(/pointer-events: none/);
    await expect(user.click(screen.getByText('Save', { selector: 'button' }))).rejects.toThrow(
      /pointer-events: none/,
    );
    // ...so the tap goes to the page under it, which already works again.
    await user.click(screen.getByRole('button', { name: 'Assist' }));
    expect(onAssist).toHaveBeenCalledTimes(1);

    endExit();
    await waitForClosed();
  });
});
