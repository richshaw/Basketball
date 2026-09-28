import { describe, expect, it } from 'vitest';
import { exampleSeason, pastOpponents } from './newGame';

describe('pastOpponents', () => {
  it('lists each team once, most recent first, keeping the latest spelling', () => {
    const games = [
      { opponent: 'Central Catholic' },
      { opponent: 'Lincoln' },
      { opponent: ' central catholic ' },
      { opponent: 'Roosevelt' },
      { opponent: 'LINCOLN' },
    ];
    expect(pastOpponents(games)).toEqual(['Central Catholic', 'Lincoln', 'Roosevelt']);
  });

  it('returns nothing before the first game', () => {
    expect(pastOpponents([])).toEqual([]);
  });
});

describe('exampleSeason', () => {
  it.each([
    ['2026-01-15', 'Winter 2026'],
    ['2026-02-28', 'Winter 2026'],
    ['2026-03-01', 'Spring 2026'],
    ['2026-07-04', 'Summer 2026'],
    ['2026-09-28', 'Fall 2026'],
    ['2026-11-30', 'Fall 2026'],
    // December starts the winter that runs into the next year, named for that year.
    ['2026-12-05', 'Winter 2027'],
    ['2026-12-31', 'Winter 2027'],
    ['2027-01-02', 'Winter 2027'],
  ])('suggests a season like the one on %s', (today, season) => {
    expect(exampleSeason(today)).toBe(season);
  });
});
