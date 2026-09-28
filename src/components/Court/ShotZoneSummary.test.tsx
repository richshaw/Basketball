import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Shot } from './shots';
import { ShotZoneSummary } from './ShotZoneSummary';

const shots: Shot[] = [
  // Paint: 2 of 3.
  { location: { x: 0, y: 1 }, made: true },
  { location: { x: 2, y: 4 }, made: true },
  { location: { x: -5, y: 12 }, made: false },
  // Mid-range: 1 of 3.
  { location: { x: -9, y: 10 }, made: true },
  { location: { x: 15, y: -2 }, made: false },
  { location: { x: 0, y: 17 }, made: false },
];

/** What each tile shows, and what a screen reader hears for its label and detail. */
function tiles() {
  return screen.getAllByRole('term').map((term) => {
    const [value, detail] = [term.nextElementSibling, term.nextElementSibling?.nextElementSibling];
    return {
      label: term.querySelector('[aria-hidden="true"]')?.textContent,
      spokenLabel: term.querySelector('.visually-hidden')?.textContent,
      value: value?.textContent,
      detail: detail?.querySelector('[aria-hidden="true"]')?.textContent,
      spokenDetail: detail?.querySelector('.visually-hidden')?.textContent,
    };
  });
}

describe('ShotZoneSummary', () => {
  it('shows the percentage and made/attempted for each zone', () => {
    render(<ShotZoneSummary shots={shots} />);
    expect(tiles()).toEqual([
      {
        label: 'Paint',
        spokenLabel: 'Paint',
        value: '67%',
        detail: '2/3',
        spokenDetail: '2 of 3 made',
      },
      {
        label: 'Mid-range',
        spokenLabel: 'Mid-range',
        value: '33%',
        detail: '1/3',
        spokenDetail: '1 of 3 made',
      },
      {
        label: '3PT',
        spokenLabel: '3-point range',
        value: '–',
        detail: '0/0',
        spokenDetail: '0 of 0 made',
      },
    ]);
  });

  it('is a named group of three tiles', () => {
    const { container } = render(
      <ShotZoneSummary shots={shots} aria-label="Shooting by zone this game" />,
    );
    const grid = container.querySelector('dl');
    expect(grid).toHaveAttribute('aria-label', 'Shooting by zone this game');
    expect(grid).toHaveClass('columns3');
    expect(within(grid as HTMLElement).getAllByRole('term')).toHaveLength(3);
  });

  it('shows a dash for zones with no shots', () => {
    render(<ShotZoneSummary shots={[]} />);
    expect(screen.getAllByText('–')).toHaveLength(3);
    expect(screen.getAllByText('0/0')).toHaveLength(3);
  });
});
