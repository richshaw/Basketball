import { act, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Shot } from '@/data/shots';
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
  it('shows the court to just past the top of the arc, outlined while a shot takes its spot', () => {
    const { court, update } = renderCourt();
    // 28 ft from the baseline (plus a foot of floor behind it), sideline to sideline.
    expect(COURT_DEPTH).toBe(28);
    expect(court()).toHaveAttribute('viewBox', '-10 -10 520 290');
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
