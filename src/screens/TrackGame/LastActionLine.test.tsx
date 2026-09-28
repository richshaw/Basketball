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

  it('runs each action once, however many taps reach it', async () => {
    const onAction = vi.fn();
    render(<LastActionLine action={action({ onAction })} />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(undo).toBeEnabled());

    fireEvent.click(undo);
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('ignores taps for a moment after the line changes, then takes the new action', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<LastActionLine action={action({ onAction: first })} />);
    const button = screen.getByRole('button', { name: 'Undo' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    // E.g. Retry saved the stat and the line now offers Undo in the same spot: the
    // second tap of a double tap mustn't undo it.
    const shownAt = performance.now();
    rerender(<LastActionLine action={action({ key: 2, onAction: second })} />);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(second).not.toHaveBeenCalled();

    await waitFor(() => expect(button).toBeEnabled());
    expect(performance.now() - shownAt).toBeGreaterThanOrEqual(DOUBLE_TAP_MS - 50);
    fireEvent.click(button);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('shows a message without a button', () => {
    render(<LastActionLine action={{ key: 3, message: 'Removed Steal', tone: 'muted' }} />);
    expect(screen.getByRole('status', { name: 'Last action' })).toHaveTextContent('Removed Steal');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
