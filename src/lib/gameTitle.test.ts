import { describe, expect, it } from 'vitest';
import { gameTitle } from './gameTitle';

describe('gameTitle', () => {
  it('reads "vs" for home, neutral and unknown venues, and "@" for away games', () => {
    expect(gameTitle({ opponent: 'Central', homeAway: 'home' })).toBe('vs Central');
    expect(gameTitle({ opponent: 'Central', homeAway: 'neutral' })).toBe('vs Central');
    expect(gameTitle({ opponent: 'Central' })).toBe('vs Central');
    expect(gameTitle({ opponent: 'Central', homeAway: 'away' })).toBe('@ Central');
  });
});
