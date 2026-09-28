import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Shot } from '@/data/shots';
import { ShotMap } from './ShotMap';

const shots: Shot[] = [
  { location: { x: 0.5, y: 1 }, made: true, points: 2 },
  { location: { x: -1, y: 3 }, made: false, points: 2 },
  { location: { x: -9, y: 10 }, made: true, points: 2 },
  { location: { x: 22.5, y: -2 }, made: true, points: 3 },
  { location: { x: 4, y: 22 }, made: false, points: 3 },
];

function court() {
  return screen.getByRole('img', { name: /^(Shot chart|Season)/ });
}

function legend() {
  return screen.getByText('Made').closest('p');
}

describe('ShotMap', () => {
  it('draws a filled circle for each make and an × for each miss', () => {
    render(<ShotMap shots={shots} />);
    expect(court().querySelectorAll('.made')).toHaveLength(3);
    expect(court().querySelectorAll('.miss')).toHaveLength(2);
    expect(court().querySelector('.markers')).not.toHaveClass('faint');
  });

  it('places each marker on its spot', () => {
    render(<ShotMap shots={shots.slice(0, 2)} />);
    const made = court().querySelector('.made');
    expect(made).toHaveAttribute('cx', '255');
    expect(made).toHaveAttribute('cy', '62.5');
    expect(court().querySelector('.miss')).toHaveAttribute('transform', 'translate(240 82.5)');
  });

  it('keys the markers with a legend of makes and misses', () => {
    render(<ShotMap shots={shots} />);
    expect(legend()).toHaveTextContent('Made 3 · Missed 2');
    expect(screen.getByText('Made')).toHaveTextContent('Made 3');
    expect(screen.getByText('Missed')).toHaveTextContent('Missed 2');
  });

  it('sums the shots and zones up for screen readers', () => {
    render(<ShotMap shots={shots} />);
    expect(court()).toHaveAccessibleName(
      'Shot chart: 5 shots on the map, 3 made (60%). Paint: 1 of 2. Mid-range: 1 of 1. ' +
        '3-pointers: 1 of 2.',
    );
    expect(screen.queryByText(/have a location/)).not.toBeInTheDocument();
  });

  it('maps only the shots with a location, and says how many have one', () => {
    render(
      <ShotMap
        shots={[...shots, { made: true, points: 3 }, { made: false, points: 2 }]}
        title="Shot chart"
      />,
    );
    expect(court().querySelectorAll('.made, .miss')).toHaveLength(5);
    expect(legend()).toHaveTextContent('Made 3 · Missed 2');
    expect(screen.getByText('5 of 7 shots have a location')).toBeInTheDocument();
    // Every 3-pointer counts in its zone, with or without a location.
    expect(court()).toHaveAccessibleName(/3-pointers: 2 of 3\. 5 of 7 shots have a location\.$/);
  });

  it('shows a title and caption, which also name the chart', () => {
    render(<ShotMap shots={shots} title="Season shot chart" caption="Fall 2026 · 10 games" />);
    const figure = screen.getByRole('figure', { name: 'Season shot chart Fall 2026 · 10 games' });
    expect(within(figure).getByText('Season shot chart')).toBeInTheDocument();
    expect(court()).toHaveAccessibleName(/^Season shot chart: 5 shots on the map, 3 made/);
  });

  it('names the chart "Shot chart" without a title, even an empty one', () => {
    render(<ShotMap shots={shots} title="" />);
    expect(court()).toHaveAccessibleName(/^Shot chart: 5 shots/);
    expect(screen.queryByRole('figure', { name: /./ })).not.toBeInTheDocument();
  });

  it('shows an empty court when there are no shots', () => {
    render(<ShotMap shots={[]} />);
    expect(court().querySelectorAll('.made, .miss')).toHaveLength(0);
    expect(legend()).toHaveTextContent('Made 0 · Missed 0');
    expect(court()).toHaveAccessibleName('Shot chart: No shots yet.');
    expect(screen.queryByText(/location/)).not.toBeInTheDocument();
  });
});
