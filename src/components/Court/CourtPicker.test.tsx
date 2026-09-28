import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CourtPoint } from '@/data/types';
import { FREE_THROW_LINE_Y } from '@/lib/court';
import { courtToSvg } from './courtGeometry';
import { CourtPicker, type CourtPickerProps } from './CourtPicker';
import { mockScreenCtm, svgToClient, type ScreenTransform } from './courtTestUtils';

// jsdom does no layout: pretend the court is drawn 0.7px per unit with SVG (0, 0) at (20, 150).
const transform: ScreenTransform = { scale: 0.7, originX: 20, originY: 150 };

function clientPoint(point: CourtPoint) {
  return svgToClient(courtToSvg(point), transform);
}

function renderPicker(props: Partial<CourtPickerProps> = {}) {
  const onPick = vi.fn<(point: CourtPoint) => void>();
  const view = render(<CourtPicker onPick={onPick} {...props} />);
  const court = screen.getByRole('img', { name: /^Shot location/ });
  mockScreenCtm(court, transform);
  return { ...view, onPick, court };
}

/** A press and release at `point`, on `target` (the court, or anything drawn on it). */
function tap(target: Element, point: CourtPoint, init: PointerEventInit = {}) {
  const pointer = { pointerId: 7, isPrimary: true, button: 0, ...clientPoint(point), ...init };
  fireEvent.pointerDown(target, pointer);
  fireEvent.pointerUp(target, pointer);
}

describe('CourtPicker', () => {
  it('calls onPick with the tapped spot, in feet', () => {
    const { onPick, court } = renderPicker();
    tap(court, { x: 0, y: FREE_THROW_LINE_Y });
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ x: 0, y: FREE_THROW_LINE_Y });
  });

  it('takes taps anywhere on the court, lines and markers included', () => {
    const { onPick, court } = renderPicker({
      shots: [{ location: { x: 3, y: 4 }, made: true, points: 2 }],
    });
    const line = court.querySelector('path');
    const marker = court.querySelector('circle.made');
    expect(line).not.toBeNull();
    expect(marker).not.toBeNull();

    tap(line as Element, { x: -19.75, y: 0 });
    tap(marker as Element, { x: 3, y: 4 });
    tap(court, { x: 23.5, y: -4.5 });
    expect(onPick.mock.calls).toEqual([
      [{ x: -19.75, y: 0 }],
      [{ x: 3, y: 4 }],
      [{ x: 23.5, y: -4.5 }],
    ]);
  });

  it('lands a tap just outside the lines on the court', () => {
    const { onPick, court } = renderPicker();
    // Half a foot past the right sideline (on the floor drawn around the court).
    tap(court, { x: 25.5, y: 10 });
    expect(onPick).toHaveBeenCalledWith({ x: 25, y: 10 });
  });

  it('works with a mouse click and a touch tap', async () => {
    const user = userEvent.setup();
    const { onPick, court } = renderPicker();
    await user.pointer({
      keys: '[MouseLeft]',
      target: court,
      coords: clientPoint({ x: -6, y: 2 }),
    });
    await user.pointer({ keys: '[TouchA]', target: court, coords: clientPoint({ x: 12, y: 30 }) });
    expect(onPick.mock.calls).toEqual([[{ x: -6, y: 2 }], [{ x: 12, y: 30 }]]);
  });

  it('ignores a touch the browser took over, other buttons and extra fingers', () => {
    const { onPick, court } = renderPicker();
    const spot = clientPoint({ x: 4, y: 8 });

    // Scrolling the page cancels the pointer before it lifts.
    fireEvent.pointerDown(court, { pointerId: 1, isPrimary: true, button: 0, ...spot });
    fireEvent.pointerCancel(court, { pointerId: 1, isPrimary: true, ...spot });
    fireEvent.pointerUp(court, { pointerId: 1, isPrimary: true, button: 0, ...spot });

    // A right click, and a second finger while the first is down.
    tap(court, { x: 4, y: 8 }, { button: 2 });
    tap(court, { x: 4, y: 8 }, { pointerId: 2, isPrimary: false });

    // A release with no press on the court (e.g. a drag that started elsewhere).
    fireEvent.pointerUp(court, { pointerId: 3, isPrimary: true, button: 0, ...spot });

    expect(onPick).not.toHaveBeenCalled();
  });

  it('never takes focus from where it was', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <>
        <button type="button">Made</button>
        <CourtPicker onPick={onPick} />
      </>,
    );
    const court = screen.getByRole('img', { name: /^Shot location/ });
    mockScreenCtm(court, transform);
    const button = screen.getByRole('button', { name: 'Made' });
    button.focus();

    await user.pointer({ keys: '[MouseLeft]', target: court, coords: clientPoint({ x: 1, y: 1 }) });
    expect(onPick).toHaveBeenCalledOnce();
    expect(button).toHaveFocus();
    // Not focusable itself, so it's never a stop (or a trap) for the keyboard.
    expect(court).not.toHaveAttribute('tabindex');
  });

  it('shows the picked spot with the value of a shot from there', () => {
    const { court, rerender, onPick } = renderPicker({ pending: { x: 22, y: -3 } });
    expect(within(court).getByText('3PT')).toBeInTheDocument();
    expect(court).toHaveAccessibleName(
      'Shot location. Picked: 3-pointer, 22 feet from the basket.',
    );

    rerender(<CourtPicker onPick={onPick} pending={{ x: -8, y: 12 }} />);
    expect(within(court).getByText('2PT')).toBeInTheDocument();
    expect(within(court).queryByText('3PT')).not.toBeInTheDocument();
    expect(court).toHaveAccessibleName(
      'Shot location. Picked: 2-pointer, 14 feet from the basket.',
    );
  });

  it('asks for a tap while no spot is picked', () => {
    const { court } = renderPicker({ pending: null });
    expect(court).toHaveAccessibleName('Shot location. Tap where the shot was taken.');
    expect(within(court).queryByText(/PT$/)).not.toBeInTheDocument();
  });

  it('takes a label of its own', () => {
    render(<CourtPicker onPick={vi.fn()} aria-label="Where was the shot?" />);
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Where was the shot? Tap where the shot was taken.',
    );
  });

  it("draws the game's earlier shots faintly", () => {
    const { court } = renderPicker({
      shots: [
        { location: { x: 0, y: 2 }, made: true, points: 2 },
        { location: { x: 10, y: 10 }, made: false, points: 2 },
        { location: { x: -21, y: -2 }, made: false, points: 2 },
      ],
    });
    const markers = court.querySelector('.markers');
    expect(markers).toHaveClass('faint');
    expect(markers?.querySelectorAll('.made')).toHaveLength(1);
    expect(markers?.querySelectorAll('.miss')).toHaveLength(2);
  });
});
