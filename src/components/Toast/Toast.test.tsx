import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import { useToast, type ToastOptions } from './toastContext';
import { TOAST_EXIT_MS, ToastProvider } from './ToastProvider';

/** Buttons that show toasts, like a screen would. */
function Buttons({ toasts }: { toasts: Record<string, ToastOptions> }) {
  const toast = useToast();
  const [lastId, setLastId] = useState(0);
  return (
    <>
      {Object.entries(toasts).map(([label, options]) => (
        <Button key={label} onClick={() => setLastId(toast.show(options))}>
          {label}
        </Button>
      ))}
      <Button onClick={() => toast.hide(lastId)}>Hide last</Button>
      <Button onClick={() => toast.hide(1)}>Hide first</Button>
      <Button onClick={() => toast.hide()}>Hide any</Button>
    </>
  );
}

function renderToasts(toasts: Record<string, ToastOptions>) {
  render(
    <ToastProvider>
      <Buttons toasts={toasts} />
    </ToastProvider>,
  );
  return { region: screen.getByRole('status', { name: 'Notifications' }) };
}

const tap = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const leavingToast = (region: HTMLElement) => region.querySelector('.leaving');

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider', () => {
  it('keeps an empty polite live region on screen', () => {
    const { region } = renderToasts({});
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('runs the action once, then fades the toast away', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { region } = renderToasts({
      Made: { message: '2PT made', actionLabel: 'Undo', onAction },
    });

    await user.click(screen.getByRole('button', { name: 'Made' }));
    expect(region).toHaveTextContent('2PT made');

    await user.click(within(region).getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(leavingToast(region)).not.toBeNull();
    await vi.waitFor(() => {
      expect(region).toBeEmptyDOMElement();
    });
  });

  it("stays put after its action is tapped, so a double tap can't fall through", () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const { region } = renderToasts({
      Made: { message: '2PT made', actionLabel: 'Undo', onAction },
    });
    tap('Made');
    const undo = within(region).getByRole('button', { name: 'Undo' });

    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledTimes(1);
    // Still on screen (and still catching taps), just no longer acting on them.
    expect(undo).toBeInTheDocument();
    expect(undo).toHaveAttribute('aria-disabled', 'true');

    wait(TOAST_EXIT_MS - 1);
    expect(undo).toBeInTheDocument();
    wait(1);
    expect(region).toBeEmptyDOMElement();
  });

  it('shows a toast asked for during the exit only once the old one is gone', () => {
    vi.useFakeTimers();
    function UndoThenConfirm() {
      const toast = useToast();
      return (
        <Button
          onClick={() =>
            toast.show({
              message: '2PT made',
              actionLabel: 'Undo',
              onAction: () => toast.show({ message: 'Undone' }),
            })
          }
        >
          Made
        </Button>
      );
    }
    render(
      <ToastProvider>
        <UndoThenConfirm />
      </ToastProvider>,
    );
    const region = screen.getByRole('status', { name: 'Notifications' });
    tap('Made');
    fireEvent.click(within(region).getByRole('button', { name: 'Undo' }));

    // "Undone" has no button: shown now, a second tap on Undo would pass through it.
    expect(region).toHaveTextContent('2PT made');
    expect(region).not.toHaveTextContent('Undone');
    wait(TOAST_EXIT_MS);
    expect(region).toHaveTextContent('Undone');
  });

  it('hides on its own after four seconds by default', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({ Made: { message: '2PT made' } });
    tap('Made');

    wait(3999);
    expect(leavingToast(region)).toBeNull();
    wait(1);
    expect(leavingToast(region)).not.toBeNull();
    wait(TOAST_EXIT_MS);
    expect(region).toBeEmptyDOMElement();
  });

  it('uses a custom duration, and Infinity keeps it up', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({
      Quick: { message: 'Saved', duration: 1000 },
      Sticky: { message: 'Offline', duration: Infinity },
    });
    tap('Quick');
    wait(1000);
    wait(TOAST_EXIT_MS);
    expect(region).toBeEmptyDOMElement();

    tap('Sticky');
    wait(60_000);
    expect(region).toHaveTextContent('Offline');
    expect(leavingToast(region)).toBeNull();
  });

  it('shows one toast at a time: a new one replaces the old and restarts the timer', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({
      Made: { message: '2PT made' },
      Rebound: { message: 'Rebound' },
    });
    tap('Made');
    wait(3000);
    tap('Rebound');
    expect(region).toHaveTextContent('Rebound');
    expect(region).not.toHaveTextContent('2PT made');

    wait(3000);
    expect(leavingToast(region)).toBeNull();
    wait(1000);
    wait(TOAST_EXIT_MS);
    expect(region).toBeEmptyDOMElement();
  });

  it('hides a toast by id only while it is the one showing, or everything without one', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({
      Made: { message: '2PT made' },
      Rebound: { message: 'Rebound' },
    });
    tap('Made');
    tap('Rebound');
    tap('Hide first');
    expect(leavingToast(region)).toBeNull();

    tap('Hide last');
    expect(leavingToast(region)).not.toBeNull();
    wait(TOAST_EXIT_MS);
    expect(region).toBeEmptyDOMElement();

    tap('Made');
    tap('Hide any');
    wait(TOAST_EXIT_MS);
    expect(region).toBeEmptyDOMElement();
  });

  it('can float at the top, clear of controls at the bottom of the screen', () => {
    const { region } = renderToasts({
      Low: { message: 'Saved' },
      High: { message: 'Saved', placement: 'top' },
    });
    tap('Low');
    expect(region).toHaveClass('bottom');
    tap('High');
    expect(region).toHaveClass('top');
  });

  it('holds while it has keyboard focus, and not once focus is gone', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({
      Made: { message: '2PT made', actionLabel: 'Undo', onAction: () => {} },
      Rebound: { message: 'Rebound' },
    });
    tap('Made');
    act(() => within(region).getByRole('button', { name: 'Undo' }).focus());
    wait(10_000);
    expect(leavingToast(region)).toBeNull();

    // Replacing the focused toast removes the focus with it: nothing is held any more.
    tap('Rebound');
    wait(4000);
    expect(leavingToast(region)).not.toBeNull();
  });

  it('moves one lasting live region into an open sheet, where it can be seen and tapped', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    function ShareSheet({ open }: { open: boolean }) {
      const toast = useToast();
      return (
        <Sheet open={open} onClose={() => {}} title="Share">
          <Button onClick={() => toast.show({ message: 'Copied', actionLabel: 'Undo', onAction })}>
            Copy
          </Button>
        </Sheet>
      );
    }
    const { rerender } = render(
      <ToastProvider>
        <ShareSheet open={false} />
      </ToastProvider>,
    );
    const region = screen.getByRole('status', { name: 'Notifications' });

    rerender(
      <ToastProvider>
        <ShareSheet open />
      </ToastProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Share' });
    // The same element, now inside the sheet: never re-created, so announcements keep working.
    expect(within(dialog).getByRole('status', { name: 'Notifications' })).toBe(region);
    expect(region).toHaveClass('overSheet');
    expect(region.closest('[inert]')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Copy' }));
    await user.click(within(region).getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(
      <ToastProvider>
        <ShareSheet open={false} />
      </ToastProvider>,
    );
    expect(dialog).not.toContainElement(region);
    expect(region).toBeInTheDocument();
    expect(region).not.toHaveClass('overSheet');
  });

  it('explains a missing provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Buttons toasts={{}} />)).toThrow(/ToastProvider/);
  });
});

describe('ToastOptions', () => {
  it('takes an action label and its handler only together', () => {
    const complete: ToastOptions[] = [
      { message: 'Saved' },
      { message: '2PT made', actionLabel: 'Undo', onAction: () => {} },
    ];
    // @ts-expect-error an action button needs a handler
    const labelOnly: ToastOptions = { message: '2PT made', actionLabel: 'Undo' };
    // @ts-expect-error a handler needs a button label
    const handlerOnly: ToastOptions = { message: '2PT made', onAction: () => {} };
    expect([...complete, labelOnly, handlerOnly]).toHaveLength(4);
  });
});
