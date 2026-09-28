import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Shot } from './shots';
import { ShotMap } from './ShotMap';

const shots: Shot[] = [
  { location: { x: 0.5, y: 1 }, made: true },
  { location: { x: -1, y: 3 }, made: false },
  { location: { x: -9, y: 10 }, made: true },
  { location: { x: 22.5, y: -2 }, made: true },
  { location: { x: 4, y: 22 }, made: false },
];

function court() {
  return screen.getByRole('img', { name: /^(Shot chart|Season)/ });
}

describe('ShotMap', () => {
  it('draws a filled circle for each make and an × for each miss', () => {
    render(<ShotMap shots={shots} />);
    expect(court().querySelectorAll('.made')).toHaveLength(3);
    expect(court().querySelectorAll('.miss')).toHaveLength(2);
    expect(court().querySelector('.markers')).not.toHaveClass('faint');
  });

  it('places each marker on its spot', () => {
    render(<ShotMap shots={[{ location: { x: 0.5, y: 1 }, made: true }, shots[1] as Shot]} />);
    const made = court().querySelector('.made');
    expect(made).toHaveAttribute('cx', '255');
    expect(made).toHaveAttribute('cy', '62.5');
    expect(court().querySelector('.miss')).toHaveAttribute('transform', 'translate(240 82.5)');
  });

  it('keys the markers with a legend of makes and misses', () => {
    render(<ShotMap shots={shots} />);
    const legend = screen.getByText('Made').closest('p');
    expect(legend).toHaveTextContent('Made 3 · Missed 2');
    expect(screen.getByText('Made')).toHaveTextContent('Made 3');
    expect(screen.getByText('Missed')).toHaveTextContent('Missed 2');
  });

  it('sums the shots and zones up for screen readers', () => {
    render(<ShotMap shots={shots} />);
    expect(court()).toHaveAccessibleName(
      'Shot chart: 5 shots, 3 made (60%). Paint: 1 of 2. Mid-range: 1 of 1. 3-point range: 1 of 2.',
    );
  });

  it('shows a title and caption, which also name the chart', () => {
    render(<ShotMap shots={shots} title="Season shot chart" caption="Fall 2026 · 10 games" />);
    const figure = screen.getByRole('figure', { name: 'Season shot chart Fall 2026 · 10 games' });
    expect(within(figure).getByText('Season shot chart')).toBeInTheDocument();
    expect(court()).toHaveAccessibleName(/^Season shot chart: 5 shots, 3 made/);
  });

  it('shows an empty court when no shot has a location', () => {
    render(<ShotMap shots={[]} />);
    expect(court().querySelectorAll('.made, .miss')).toHaveLength(0);
    expect(screen.getByText('Made').closest('p')).toHaveTextContent('Made 0 · Missed 0');
    expect(court()).toHaveAccessibleName('Shot chart: No shots with a location yet.');
    expect(screen.queryByRole('figure', { name: /./ })).not.toBeInTheDocument();
  });
});
