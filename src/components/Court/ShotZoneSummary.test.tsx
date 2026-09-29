import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shotsFromEvents, type Shot } from '@/data/shots';
import { computeStatLine } from '@/data/stats';
import type { StatEvent, StatType } from '@/data/types';
import { ShotZoneSummary } from './ShotZoneSummary';

const shots: Shot[] = [
  // Paint: 2 of 3.
  { location: { x: 0, y: 1 }, made: true, points: 2 },
  { location: { x: 2, y: 4 }, made: true, points: 2 },
  { location: { x: -5, y: 12 }, made: false, points: 2 },
  // Mid-range: 1 of 3, including a two from beyond the arc (a foot on the line).
  { location: { x: -9, y: 10 }, made: true, points: 2 },
  { location: { x: 15, y: -2 }, made: false, points: 2 },
  { location: { x: 0, y: 21 }, made: false, points: 2 },
  // A two with no location: in neither 2PT zone.
  { made: true, points: 2 },
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
        spokenLabel: '3-pointers',
        value: '–',
        detail: '0/0',
        spokenDetail: '0 of 0 made',
      },
    ]);
  });

  it('matches the box score for 3-pointers, wherever they were tapped', () => {
    let id = 0;
    const event = (type: StatType, location?: StatEvent['location']): StatEvent => ({
      id: `e${++id}`,
      gameId: 'g',
      type,
      period: 1,
      createdAt: id,
      ...(location ? { location } : {}),
    });
    const events = [
      event('fg3_made', { x: 22, y: -3 }),
      // Recorded as a 3 but tapped just inside the arc.
      event('fg3_made', { x: 0, y: 19 }),
      event('fg3_miss'),
      event('fg2_made', { x: 0, y: 2 }),
    ];
    render(<ShotZoneSummary shots={shotsFromEvents(events)} />);

    const line = computeStatLine(events);
    const three = tiles()[2];
    expect(three?.detail).toBe(`${line.fg3m}/${line.fg3a}`);
    expect(three?.detail).toBe('2/3');
    expect(three?.value).toBe('67%');
    expect(tiles()[1]?.detail).toBe('0/0');
    // One of them isn't on the map: the tiles count 4 shots, the map 3.
    expect(
      screen.getByText('3PT counts every 3-point attempt, with a location or not.'),
    ).toBeVisible();
  });

  it('says nothing more when the tiles count the same shots as the map', () => {
    // Every 3 has a spot; a 2 without one counts in neither the map nor the tiles.
    render(
      <ShotZoneSummary
        shots={[...shots, { location: { x: 20, y: 15 }, made: false, points: 3 }]}
      />,
    );
    expect(screen.queryByText(/3PT counts every 3-point attempt/)).toBeNull();
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
