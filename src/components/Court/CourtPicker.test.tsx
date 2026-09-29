import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CourtPoint } from '@/data/types';
import { FREE_THROW_LINE_Y } from '@/lib/court';
import { courtToSvg, courtViewBox, viewBoxAttribute } from './courtGeometry';
import { CourtPicker, type CourtPickerProps } from './CourtPicker';
import { courtBox, mockScreenBox, svgToClient, type CourtPlacement } from './courtTestUtils';

// jsdom does no layout: pretend the court is drawn 0.7px per unit with its view box's
// corner at (20, 150) on screen.
const placement: CourtPlacement = { scale: 0.7, left: 20, top: 150 };

function clientPoint(point: CourtPoint, where: CourtPlacement = placement) {
  return svgToClient(courtToSvg(point), where);
}

function getCourt() {
  return screen.getByRole('img', { name: /^Shot location/ });
}

function renderPicker(props: Partial<CourtPickerProps> = {}) {
  const onPick = vi.fn<(point: CourtPoint) => void>();
  const view = render(<CourtPicker onPick={onPick} {...props} />);
  const court = getCourt();
  mockScreenBox(court, courtBox(placement));
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

  it('takes a tap while another finger is down elsewhere; the latest press wins', () => {
    const { onPick, court } = renderPicker();
    // A thumb resting on a stat button doesn't stop a tap on the court...
    tap(court, { x: 4, y: 8 }, { pointerId: 2, isPrimary: false });
    expect(onPick).toHaveBeenLastCalledWith({ x: 4, y: 8 });

    // ...and with two fingers on the court, the one pressed last picks the spot.
    const first = { pointerId: 3, isPrimary: true, button: 0, ...clientPoint({ x: -10, y: 5 }) };
    const second = { pointerId: 4, isPrimary: false, button: 0, ...clientPoint({ x: 10, y: 5 }) };
    fireEvent.pointerDown(court, first);
    fireEvent.pointerDown(court, second);
    fireEvent.pointerUp(court, first);
    fireEvent.lostPointerCapture(court, first);
    fireEvent.pointerUp(court, second);
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith({ x: 10, y: 5 });
  });

  it('ignores touches the browser took over, other buttons and releases off the court', () => {
    const { onPick, court } = renderPicker();
    const spot = clientPoint({ x: 4, y: 8 });

    // Scrolling the page cancels the pointer before it lifts.
    fireEvent.pointerDown(court, { pointerId: 1, button: 0, ...spot });
    fireEvent.pointerCancel(court, { pointerId: 1, ...spot });
    fireEvent.pointerUp(court, { pointerId: 1, button: 0, ...spot });

    // The capture ended some other way (e.g. the element was removed or re-parented).
    fireEvent.pointerDown(court, { pointerId: 2, button: 0, ...spot });
    fireEvent.lostPointerCapture(court, { pointerId: 2, ...spot });
    fireEvent.pointerUp(court, { pointerId: 2, button: 0, ...spot });

    // A right click.
    tap(court, { x: 4, y: 8 }, { button: 2 });

    // A mouse pressed on the court and released off it (the release still comes here).
    fireEvent.pointerDown(court, { pointerId: 3, button: 0, ...spot });
    fireEvent.pointerUp(court, { pointerId: 3, button: 0, clientX: 5, clientY: 60 });

    // A release with no press on the court (e.g. a drag that started elsewhere).
    fireEvent.pointerUp(court, { pointerId: 4, button: 0, ...spot });

    expect(onPick).not.toHaveBeenCalled();
    // None of that leaves a press hanging: the next tap works.
    tap(court, { x: 4, y: 8 });
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ x: 4, y: 8 });
  });

  it("keeps the tap's click from landing on what appears under the finger", () => {
    const { court } = renderPicker();
    const touchEnd = createEvent.touchEnd(court);
    fireEvent(court, touchEnd);
    expect(touchEnd.defaultPrevented).toBe(true);
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
    const court = getCourt();
    mockScreenBox(court, courtBox(placement));
    const button = screen.getByRole('button', { name: 'Made' });
    button.focus();

    await user.pointer({ keys: '[MouseLeft]', target: court, coords: clientPoint({ x: 1, y: 1 }) });
    expect(onPick).toHaveBeenCalledOnce();
    expect(button).toHaveFocus();
    // Not focusable itself, so it's never a stop (or a trap) for the keyboard.
    expect(court).not.toHaveAttribute('tabindex');
  });

  it('never zooms on a double tap, and can take every touch as a tap', () => {
    const { court, rerender, onPick } = renderPicker();
    expect(court).toHaveClass('picker', 'touchManipulation');
    rerender(<CourtPicker onPick={onPick} touchAction="none" />);
    expect(court).toHaveClass('picker', 'touchNone');
    expect(court).not.toHaveClass('touchManipulation');
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

  it("labels the picked spot with the shot's own value when it's known", () => {
    // A two, recorded with the 2PT button, from beyond the arc.
    const { court, rerender, onPick } = renderPicker({
      pending: { x: 22, y: -3 },
      pendingPoints: 2,
    });
    expect(within(court).getByText('2PT')).toBeInTheDocument();
    expect(within(court).queryByText('3PT')).not.toBeInTheDocument();
    expect(court).toHaveAccessibleName(
      'Shot location. Picked: 2-pointer, 22 feet from the basket.',
    );

    // A three, from inside it.
    rerender(<CourtPicker onPick={onPick} pending={{ x: -8, y: 12 }} pendingPoints={3} />);
    expect(within(court).getByText('3PT')).toBeInTheDocument();
    expect(court).toHaveAccessibleName(
      'Shot location. Picked: 3-pointer, 14 feet from the basket.',
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

  it("draws the game's earlier shots with a location faintly", () => {
    const { court } = renderPicker({
      shots: [
        { location: { x: 0, y: 2 }, made: true, points: 2 },
        { location: { x: 10, y: 10 }, made: false, points: 2 },
        { location: { x: -21, y: -2 }, made: false, points: 3 },
        { made: true, points: 3 },
      ],
    });
    const markers = court.querySelector('.markers');
    expect(markers).toHaveClass('faint');
    expect(markers?.querySelectorAll('.made')).toHaveLength(1);
    expect(markers?.querySelectorAll('.miss')).toHaveLength(2);
  });

  describe('cropped to a depth', () => {
    const depth = 30;
    const cropped: CourtPlacement = { ...placement, viewBox: courtViewBox(depth) };

    function renderCropped(props: Partial<CourtPickerProps> = {}) {
      const onPick = vi.fn<(point: CourtPoint) => void>();
      render(<CourtPicker onPick={onPick} depth={depth} {...props} />);
      const court = getCourt();
      mockScreenBox(court, courtBox(cropped));
      return { onPick, court };
    }

    it('shows only that far from the baseline, and maps taps on it', () => {
      const { onPick, court } = renderCropped();
      expect(court).toHaveAttribute('viewBox', viewBoxAttribute(courtViewBox(depth)));
      expect(court).toHaveAttribute('height', '310');

      const spot = { x: -7.5, y: 22 };
      const pointer = { pointerId: 1, button: 0, ...clientPoint(spot, cropped) };
      fireEvent.pointerDown(court, pointer);
      fireEvent.pointerUp(court, pointer);
      expect(onPick).toHaveBeenCalledExactlyOnceWith(spot);
    });

    it('keeps the picked spot and its label inside the crop', () => {
      // 35 ft from the basket: past the bottom of a 30 ft crop.
      const { court } = renderCropped({ pending: { x: 24.5, y: 35 } });
      const view = courtViewBox(depth);
      const marker = court.querySelector('.picked > g');
      const [, markerX = NaN, markerY = NaN] =
        /translate\(([\d.-]+) ([\d.-]+)\)/.exec(marker?.getAttribute('transform') ?? '') ?? [];
      expect(Number(markerY)).toBeLessThanOrEqual(view.y + view.height - 20);
      expect(Number(markerX)).toBeLessThanOrEqual(view.x + view.width - 20);

      const label = court.querySelector('.label');
      const [, labelX = NaN, labelY = NaN] =
        /translate\(([\d.-]+) ([\d.-]+)\)/.exec(label?.getAttribute('transform') ?? '') ?? [];
      // Left of the marker (no room on its right), and above the bottom edge.
      expect(Number(labelX)).toBeLessThan(Number(markerX));
      expect(Number(labelY)).toBeLessThanOrEqual(view.y + view.height - 34);
      expect(within(court).getByText('3PT')).toBeInTheDocument();
    });
  });
});
