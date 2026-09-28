import { describe, expect, it } from 'vitest';
import { computeStatLine, type StatLine } from '@/data/stats';
import type { Game, StatType } from '@/data/types';
import { buildGameRecap, gameOutcome, matchupLabel, recapTitle, resultLabel } from './recap';

/** A stat line from counts of each stat type, e.g. `lineOf({ fg2_made: 2, ast: 1 })`. */
function lineOf(counts: Partial<Record<StatType, number>>): StatLine {
  const events = Object.entries(counts).flatMap(([type, count]) =>
    Array.from({ length: count }, () => ({ type: type as StatType })),
  );
  return computeStatLine(events);
}

function gameOf(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerId: 'p1',
    opponent: 'Central',
    date: '2026-09-27',
    homeAway: 'home',
    periodFormat: 'quarters',
    currentPeriod: 4,
    status: 'final',
    teamScore: 45,
    opponentScore: 38,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const ava = { name: 'Ava' };

/** 14 PTS · 6 REB · 3 AST · 2 STL · 1 BLK, FG 5/9 · 3PT 1/3 · FT 3/4, plus a TO and 2 fouls. */
const fullLine = lineOf({
  fg2_made: 4,
  fg2_miss: 2,
  fg3_made: 1,
  fg3_miss: 2,
  ft_made: 3,
  ft_miss: 1,
  oreb: 2,
  dreb: 4,
  ast: 3,
  stl: 2,
  blk: 1,
  tov: 1,
  foul: 2,
});

describe('matchupLabel', () => {
  it('says "vs" at home, on a neutral court or when unknown, and "@" away', () => {
    expect(matchupLabel({ opponent: 'Central', homeAway: 'home' })).toBe('vs Central');
    expect(matchupLabel({ opponent: 'Central', homeAway: 'neutral' })).toBe('vs Central');
    expect(matchupLabel({ opponent: 'Central' })).toBe('vs Central');
    expect(matchupLabel({ opponent: 'Central', homeAway: 'away' })).toBe('@ Central');
  });
});

describe('gameOutcome', () => {
  it('gives the result, its word and the score', () => {
    expect(gameOutcome(gameOf())).toEqual({ result: 'W', word: 'Won', score: '45–38' });
    expect(gameOutcome(gameOf({ teamScore: 3, opponentScore: 3 }))).toEqual({
      result: 'T',
      word: 'Tied',
      score: '3–3',
    });
    expect(gameOutcome(gameOf({ status: 'live' }))).toBeNull();
  });
});

describe('resultLabel', () => {
  it('puts our score first', () => {
    expect(resultLabel(gameOf({ teamScore: 45, opponentScore: 38 }))).toBe('Won 45–38');
    expect(resultLabel(gameOf({ teamScore: 38, opponentScore: 45 }))).toBe('Lost 38–45');
    expect(resultLabel(gameOf({ teamScore: 40, opponentScore: 40 }))).toBe('Tied 40–40');
    expect(resultLabel(gameOf({ teamScore: 0, opponentScore: 2 }))).toBe('Lost 0–2');
  });

  it('has no result without both scores or while the game is live', () => {
    expect(resultLabel(gameOf({ teamScore: undefined, opponentScore: undefined }))).toBeNull();
    expect(resultLabel(gameOf({ opponentScore: undefined }))).toBeNull();
    expect(resultLabel(gameOf({ status: 'live' }))).toBeNull();
  });
});

describe('recapTitle', () => {
  it("leads with the player's name, when she has one", () => {
    expect(recapTitle(ava, gameOf())).toBe('Ava vs Central');
    expect(recapTitle({ name: '  ' }, gameOf({ homeAway: 'away' }))).toBe('@ Central');
    expect(recapTitle(null, gameOf())).toBe('vs Central');
  });
});

describe('buildGameRecap', () => {
  it('sums up a win', () => {
    expect(buildGameRecap(ava, gameOf(), fullLine)).toBe(
      [
        'Ava vs Central — Won 45–38 (Sun, Sep 27)',
        '14 PTS · 6 REB · 3 AST · 2 STL · 1 BLK',
        'FG 5/9 · 3PT 1/3 · FT 3/4',
      ].join('\n'),
    );
  });

  it('sums up a loss away from home', () => {
    const game = gameOf({ homeAway: 'away', teamScore: 38, opponentScore: 45 });
    expect(buildGameRecap(ava, game, fullLine).split('\n')[0]).toBe(
      'Ava @ Central — Lost 38–45 (Sun, Sep 27)',
    );
  });

  it('sums up a tie', () => {
    const game = gameOf({ teamScore: 40, opponentScore: 40 });
    expect(buildGameRecap(ava, game, fullLine).split('\n')[0]).toBe(
      'Ava vs Central — Tied 40–40 (Sun, Sep 27)',
    );
  });

  it('leaves the result out when no score was entered', () => {
    const noScore = gameOf({ teamScore: undefined, opponentScore: undefined });
    expect(buildGameRecap(ava, noScore, fullLine).split('\n')[0]).toBe(
      'Ava vs Central (Sun, Sep 27)',
    );
    const halfScore = gameOf({ opponentScore: undefined });
    expect(buildGameRecap(ava, halfScore, fullLine).split('\n')[0]).toBe(
      'Ava vs Central (Sun, Sep 27)',
    );
  });

  it('says a live game is in progress, and in which period, whatever the score', () => {
    const live = gameOf({ status: 'live', currentPeriod: 3 });
    expect(buildGameRecap(ava, live, fullLine)).toBe(
      [
        'Ava vs Central — In progress, Q3 (Sun, Sep 27)',
        '14 PTS · 6 REB · 3 AST · 2 STL · 1 BLK',
        'FG 5/9 · 3PT 1/3 · FT 3/4',
      ].join('\n'),
    );
    const overtime = gameOf({ status: 'live', periodFormat: 'halves', currentPeriod: 3 });
    expect(buildGameRecap(ava, overtime, fullLine).split('\n')[0]).toBe(
      'Ava vs Central — In progress, OT (Sun, Sep 27)',
    );
  });

  it('leaves out stats she did not get and shots she did not take', () => {
    const line = lineOf({ fg2_made: 1, fg2_miss: 2, dreb: 1, blk: 2, tov: 3, foul: 5 });
    expect(buildGameRecap(ava, gameOf(), line)).toBe(
      ['Ava vs Central — Won 45–38 (Sun, Sep 27)', '2 PTS · 1 REB · 2 BLK', 'FG 1/3'].join('\n'),
    );
  });

  it('always shows points, even without any', () => {
    const line = lineOf({ fg3_miss: 2, ft_miss: 1, ast: 4 });
    expect(buildGameRecap(ava, gameOf(), line)).toBe(
      [
        'Ava vs Central — Won 45–38 (Sun, Sep 27)',
        '0 PTS · 4 AST',
        'FG 0/2 · 3PT 0/2 · FT 0/1',
      ].join('\n'),
    );
  });

  it('leaves out the shooting line when she took no shots', () => {
    const line = lineOf({ oreb: 1, stl: 2 });
    expect(buildGameRecap(ava, gameOf(), line).split('\n')).toEqual([
      'Ava vs Central — Won 45–38 (Sun, Sep 27)',
      '0 PTS · 1 REB · 2 STL',
    ]);
  });

  it('adds a hustle line for deflections and charges taken', () => {
    expect(
      buildGameRecap(ava, gameOf(), lineOf({ ft_made: 1, deflection: 4, charge: 1 })).split('\n'),
    ).toEqual([
      'Ava vs Central — Won 45–38 (Sun, Sep 27)',
      '1 PTS',
      'FT 1/1',
      '4 deflections · 1 charge taken',
    ]);
    expect(buildGameRecap(ava, gameOf(), lineOf({ deflection: 1, charge: 2 })).split('\n')).toEqual(
      ['Ava vs Central — Won 45–38 (Sun, Sep 27)', '0 PTS', '1 deflection · 2 charges taken'],
    );
  });

  it('is just the first line when no stats were recorded', () => {
    expect(buildGameRecap(ava, gameOf(), lineOf({}))).toBe(
      'Ava vs Central — Won 45–38 (Sun, Sep 27)',
    );
  });

  it('starts with the matchup before the player has a name', () => {
    expect(buildGameRecap({ name: '' }, gameOf(), fullLine).split('\n')[0]).toBe(
      'vs Central — Won 45–38 (Sun, Sep 27)',
    );
    expect(buildGameRecap(null, gameOf({ homeAway: 'away' }), lineOf({})).split('\n')[0]).toBe(
      '@ Central — Won 45–38 (Sun, Sep 27)',
    );
  });
});
