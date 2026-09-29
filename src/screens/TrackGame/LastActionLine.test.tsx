import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LastActionLine, type LastAction } from './LastActionLine';
import { DOUBLE_TAP_MS } from './tracking';

const action = (overrides: Partial<LastAction> = {}): LastAction => ({
  key: 1,
  message: 'Steal · Q3',
  kind: 'other',
  actionLabel: 'Undo',
  onAction: vi.fn(),
  ...overrides,
});

describe('LastActionLine', () => {
  it('reads out only the message, not the button', () => {
    render(<LastActionLine action={action()} />);
    const status = screen.getByRole('status', { name: 'Last action' });
    expect(status).toHaveTextContent('Steal · Q3');
    expect(within(status).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('runs each action once, however many taps reach it', () => {
    const onAction = vi.fn();
    render(<LastActionLine action={action({ onAction })} />);
    const undo = screen.getByRole('button', { name: 'Undo' });

    fireEvent.click(undo);
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('takes a tap at once when a new stat shows (a quick "wrong stat, Undo")', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<LastActionLine action={action({ onAction: first })} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toBeEnabled();

    rerender(
      <LastActionLine action={action({ key: 2, message: 'Block · Q3', onAction: second })} />,
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('ignores taps for a moment after its own action, then takes the new one', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<LastActionLine action={action({ onAction: first })} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(button);

    // The line now offers another action in the same spot (e.g. after "Now in Q3",
    // Undo): the second tap of the double tap mustn't take it.
    const tappedAt = performance.now();
    rerender(<LastActionLine action={action({ key: 2, onAction: second })} />);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(second).not.toHaveBeenCalled();

    await waitFor(() => expect(button).toBeEnabled());
    expect(performance.now() - tappedAt).toBeGreaterThanOrEqual(DOUBLE_TAP_MS - 50);
    fireEvent.click(button);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("ignores taps for a moment after the grid's Undo", async () => {
    const onAction = vi.fn();
    const line = (holdKey: number) => (
      <LastActionLine action={action({ onAction })} holdKey={holdKey} />
    );
    const { rerender } = render(line(0));
    const button = screen.getByRole('button', { name: 'Undo' });
    expect(button).toBeEnabled();

    // The grid's Undo sits just above this button: the second tap of a double tap on
    // it mustn't land here.
    rerender(line(1));
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onAction).not.toHaveBeenCalled();

    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('shows a message without a button', () => {
    render(<LastActionLine action={{ key: 3, message: 'Removed Steal', tone: 'muted' }} />);
    expect(screen.getByRole('status', { name: 'Last action' })).toHaveTextContent('Removed Steal');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it("shows a note under the message, which screen readers don't hear", () => {
    const { rerender } = render(
      <LastActionLine
        action={action({ message: '2PT Made · Q3', detail: 'Tap the court to mark the spot' })}
      />,
    );
    const status = screen.getByRole('status', { name: 'Last action' });
    const note = screen.getByText('Tap the court to mark the spot');
    expect(status).toContainElement(note);
    expect(note).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('2PT Made · Q3')).not.toHaveAttribute('aria-hidden');

    rerender(<LastActionLine action={action({ message: '2PT Made · Q3' })} />);
    expect(screen.queryByText('Tap the court to mark the spot')).not.toBeInTheDocument();
    expect(status).toHaveTextContent(/^2PT Made · Q3$/);
  });
});
