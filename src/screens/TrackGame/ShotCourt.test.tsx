import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { courtToSvg, courtViewBox } from '@/components/Court/courtGeometry';
import { courtBox, mockScreenBox, svgToClient } from '@/components/Court/courtTestUtils';
import type { Shot } from '@/data/shots';
import { BASKET_FROM_BASELINE, THREE_POINT_RADIUS } from '@/lib/court';
import type { SpotShot } from './session';
import { COURT_DEPTH, COURT_HINT_MS, ShotCourt, type ShotCourtProps } from './ShotCourt';

const shot: SpotShot = {
  tap: { id: 'tap-1', type: 'fg3_miss', period: 2, at: 1 },
  until: 10_000,
};

function renderCourt(props: Partial<ShotCourtProps> = {}) {
  const all: ShotCourtProps = { shots: [], spotShot: null, onPick: vi.fn(), hintKey: 0, ...props };
  const view = render(<ShotCourt {...all} />);
  return {
    ...view,
    court: () => screen.getByRole('img', { name: /^Shot spot/ }),
    update: (next: Partial<ShotCourtProps>) => view.rerender(<ShotCourt {...all} {...next} />),
  };
}

describe('ShotCourt', () => {
  it('shows the court to 7 ft past the top of the arc, outlined while a shot takes its spot', () => {
    const { court, update } = renderCourt();
    // 32 ft from the baseline (plus a foot of floor behind it), sideline to sideline.
    expect(COURT_DEPTH).toBe(32);
    expect(COURT_DEPTH - BASKET_FROM_BASELINE - THREE_POINT_RADIUS).toBe(7);
    expect(court()).toHaveAttribute('viewBox', '-10 -10 520 330');
    expect(court().parentElement).not.toHaveClass('open');

    update({ spotShot: shot });
    expect(court().parentElement).toHaveClass('open');
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 3PT Miss (optional). Tap where the shot was taken.',
    );
    update({ spotShot: { ...shot, spot: { x: 0, y: 22 } } });
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 3PT Miss (optional). Picked: 3-pointer, 22 feet from the basket.',
    );
  });

  it('marks a deep three from the top of the key, 6 ft behind the arc, on the court', () => {
    const onPick = vi.fn();
    const { court } = renderCourt({ spotShot: shot, onPick });
    // jsdom does no layout: the court drawn 0.5px per unit (5px per foot), from (8, 120).
    const placement = { scale: 0.5, left: 8, top: 120, viewBox: courtViewBox(COURT_DEPTH) };
    mockScreenBox(court(), courtBox(placement));
    const deep = { x: 0, y: THREE_POINT_RADIUS + 6 };
    const pointer = { pointerId: 3, isPrimary: true, button: 0 };
    const at = svgToClient(courtToSvg(deep), placement);

    fireEvent.pointerDown(court(), { ...pointer, ...at });
    fireEvent.pointerUp(court(), { ...pointer, ...at });

    expect(onPick).toHaveBeenCalledExactlyOnceWith(deep);
    // With room below it on the court: a foot (5px here) before the court's edge.
    expect(courtBox(placement).top + courtBox(placement).height - at.clientY).toBe(5);
  });

  it("labels the spot with the shot's value as tapped, wherever it is", () => {
    const { court, update } = renderCourt({ spotShot: { ...shot, spot: { x: -6, y: 13.75 } } });
    // A 3PT Miss marked inside the arc: still a 3PT (the line notes where it is).
    expect(within(court()).getByText('3PT')).toBeInTheDocument();
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 3PT Miss (optional). Picked: 3-pointer, 15 feet from the basket.',
    );

    const two: SpotShot = { ...shot, tap: { ...shot.tap, type: 'fg2_made' } };
    update({ spotShot: { ...two, spot: { x: 23, y: -3 } } });
    expect(within(court()).getByText('2PT')).toBeInTheDocument();
    expect(within(court()).queryByText('3PT')).not.toBeInTheDocument();
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 2PT Made (optional). Picked: 2-pointer, 23 feet from the basket.',
    );
  });

  it("draws the game's other shots faintly", () => {
    const shots: Shot[] = [
      { made: true, points: 2, location: { x: 1, y: 2 } },
      { made: false, points: 3, location: { x: -20, y: 10 } },
      { made: false, points: 2 },
    ];
    const { court } = renderCourt({ shots });
    expect(court().querySelector('g.faint')).not.toBeNull();
    expect(court().querySelectorAll('circle.made')).toHaveLength(1);
    expect(court().querySelectorAll('g.miss')).toHaveLength(1);
  });

  it('says to tap 2PT or 3PT first for a moment after each tap that had no shot to mark', () => {
    vi.useFakeTimers();
    const { update } = renderCourt();
    const hint = () => screen.queryByText('Tap 2PT or 3PT first');
    expect(hint()).not.toBeInTheDocument();

    update({ hintKey: 1 });
    expect(hint()).toBeInTheDocument();
    // Out of screen readers' way (the court is optional), and out of the way of taps.
    expect(hint()).toHaveAttribute('aria-hidden', 'true');
    act(() => {
      vi.advanceTimersByTime(COURT_HINT_MS - 1);
    });
    // Another such tap starts it again.
    update({ hintKey: 2 });
    act(() => {
      vi.advanceTimersByTime(COURT_HINT_MS - 1);
    });
    expect(hint()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(hint()).not.toBeInTheDocument();
  });
});
