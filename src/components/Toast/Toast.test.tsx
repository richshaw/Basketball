import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import { useToast, type ToastOptions } from './toastContext';
import { ToastProvider } from './ToastProvider';

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

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastProvider', () => {
  it('keeps an empty polite live region on screen', () => {
    const { region } = renderToasts({});
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('shows a toast with its action, which runs once and hides the toast', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { region } = renderToasts({
      Made: { message: '2PT made', actionLabel: 'Undo', onAction },
    });

    await user.click(screen.getByRole('button', { name: 'Made' }));
    expect(region).toHaveTextContent('2PT made');

    await user.click(within(region).getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(region).toBeEmptyDOMElement();
  });

  it('hides on its own after four seconds by default', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({ Made: { message: '2PT made' } });
    tap('Made');

    act(() => {
      vi.advanceTimersByTime(3999);
    });
    expect(region).toHaveTextContent('2PT made');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(region).toBeEmptyDOMElement();
  });

  it('uses a custom duration, and Infinity keeps it up', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({
      Quick: { message: 'Saved', duration: 1000 },
      Sticky: { message: 'Offline', duration: Infinity },
    });
    tap('Quick');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(region).toBeEmptyDOMElement();

    tap('Sticky');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(region).toHaveTextContent('Offline');
  });

  it('shows one toast at a time: a new one replaces the old and restarts the timer', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({
      Made: { message: '2PT made' },
      Rebound: { message: 'Rebound' },
    });
    tap('Made');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    tap('Rebound');
    expect(region).toHaveTextContent('Rebound');
    expect(region).not.toHaveTextContent('2PT made');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(region).toHaveTextContent('Rebound');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(region).toBeEmptyDOMElement();
  });

  it('hides a toast by id only while it is the one showing', () => {
    const { region } = renderToasts({
      Made: { message: '2PT made' },
      Rebound: { message: 'Rebound' },
    });
    tap('Made');
    tap('Rebound');
    tap('Hide first');
    expect(region).toHaveTextContent('Rebound');

    tap('Hide last');
    expect(region).toBeEmptyDOMElement();

    tap('Made');
    tap('Hide any');
    expect(region).toBeEmptyDOMElement();
  });

  it('holds the timer while the toast has keyboard focus', () => {
    vi.useFakeTimers();
    const { region } = renderToasts({
      Made: { message: '2PT made', actionLabel: 'Undo', onAction: () => {} },
    });
    tap('Made');
    const undo = within(region).getByRole('button', { name: 'Undo' });

    act(() => undo.focus());
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(region).toHaveTextContent('2PT made');

    act(() => undo.blur());
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(region).toBeEmptyDOMElement();
  });

  it('shows the toast inside an open sheet, where it can still be seen and tapped', async () => {
    const user = userEvent.setup();
    function ShareSheet() {
      const toast = useToast();
      return (
        <Sheet open onClose={() => {}} title="Share">
          <Button onClick={() => toast.show({ message: 'Copied', actionLabel: 'Undo' })}>
            Copy
          </Button>
        </Sheet>
      );
    }
    render(
      <ToastProvider>
        <ShareSheet />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy' }));

    const dialog = screen.getByRole('dialog', { name: 'Share' });
    const region = within(dialog).getByRole('status', { name: 'Notifications' });
    expect(region).toHaveTextContent('Copied');
    expect(region).toHaveClass('overSheet');
  });

  it('explains a missing provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Buttons toasts={{}} />)).toThrow(/ToastProvider/);
  });
});
