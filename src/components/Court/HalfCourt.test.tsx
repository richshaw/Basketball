import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { HalfCourt } from './HalfCourt';

describe('HalfCourt', () => {
  it('is an image of a half court that fills its width', () => {
    render(<HalfCourt />);
    const court = screen.getByRole('img', { name: 'Basketball half court' });
    expect(court).toHaveAttribute('viewBox', '-10 -10 520 440');
    expect(court).toHaveAttribute('preserveAspectRatio', 'xMidYMid meet');
    expect(court).toHaveClass('court');
    expect(court).not.toHaveAttribute('tabindex');
  });

  it('draws the lines to scale, 10 units per foot', () => {
    render(<HalfCourt />);
    const court = screen.getByRole('img');
    const paths = [...court.querySelectorAll('path')].map((path) => path.getAttribute('d'));
    // Corner lines at x = ±19.75 ft from the baseline to the basket, joined by a 19.75 ft arc.
    expect(paths).toContain('M 52.5 0 L 52.5 52.5 A 197.5 197.5 0 0 0 447.5 52.5 L 447.5 0');
    // The free-throw circle: solid toward half court, dashed toward the basket.
    expect(paths).toContain('M 190 190 A 60 60 0 0 0 310 190');
    expect(paths).toContain('M 190 190 A 60 60 0 0 1 310 190');
    // The center circle's half on this side of the half-court line.
    expect(paths).toContain('M 190 420 A 60 60 0 0 1 310 420');

    const dashed = court.querySelector('path[stroke-dasharray]');
    expect(dashed).toHaveAttribute('d', 'M 190 190 A 60 60 0 0 1 310 190');
    // Eight 16-inch marks spread over the half circle.
    const [dash, gap] = (dashed?.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
    expect(dash).toBeCloseTo(13.33, 2);
    expect(8 * (dash ?? 0) + 7 * (gap ?? 0)).toBeCloseTo(Math.PI * 60, 1);

    // The rim, a 9-inch radius around the basket.
    const rim = court.querySelector('circle.rim');
    expect(rim).toHaveAttribute('cx', '250');
    expect(rim).toHaveAttribute('cy', '52.5');
    expect(rim).toHaveAttribute('r', '7.5');
  });

  it('draws its children over the court and passes props to the svg', () => {
    const ref = createRef<SVGSVGElement>();
    render(
      <HalfCourt ref={ref} aria-label="Shot chart" className="extra" data-testid="court">
        <circle className="marker" cx={250} cy={100} r={5} />
      </HalfCourt>,
    );
    const court = screen.getByRole('img', { name: 'Shot chart' });
    expect(ref.current).toBe(court);
    expect(court).toHaveClass('court', 'extra');
    expect(court.lastElementChild).toHaveClass('marker');
  });
});
