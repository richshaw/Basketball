import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { emptyStatLine, statLinesForGames, summarizeGames, type GamesSummary } from '@/data/stats';
import { buildSeasonRecap } from './seasonRecap';

type RecapSummary = Pick<GamesSummary, 'record' | 'averages' | 'shooting'>;

function summary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    record: { wins: 8, losses: 2, ties: 0 },
    averages: { ...emptyStatLine(), pts: 12.4, reb: 5.1, ast: 2.3, stl: 1.8 },
    shooting: { fgPct: 44.2, fg2Pct: 50, fg3Pct: 30.8, ftPct: 67.9 },
    ...overrides,
  };
}

describe('buildSeasonRecap', () => {
  it('writes the record, per-game averages and shooting on three lines', () => {
    expect(buildSeasonRecap({ name: 'Ava' }, 'Fall 2026', summary())).toBe(
      [
        'Ava — Fall 2026 (8–2)',
        '12.4 PPG · 5.1 RPG · 2.3 APG · 1.8 SPG',
        'FG 44% · 3PT 31% · FT 68%',
      ].join('\n'),
    );
  });

  it('adds ties to the record only when there are some', () => {
    const recap = buildSeasonRecap(
      { name: 'Ava' },
      'Fall 2026',
      summary({ record: { wins: 8, losses: 2, ties: 1 } }),
    );
    expect(recap.split('\n')[0]).toBe('Ava — Fall 2026 (8–2–1)');
  });

  it('leaves the record out when no game has a final score', () => {
    const recap = buildSeasonRecap(
      { name: 'Ava' },
      'Fall 2026',
      summary({ record: { wins: 0, losses: 0, ties: 0 } }),
    );
    expect(recap.split('\n')[0]).toBe('Ava — Fall 2026');
  });

  it('calls every game "All games" and an unnamed player "Player"', () => {
    expect(buildSeasonRecap(null, null, summary()).split('\n')[0]).toBe('Player — All games (8–2)');
    expect(buildSeasonRecap({ name: '  ' }, 'JV', summary()).split('\n')[0]).toBe(
      'Player — JV (8–2)',
    );
  });

  it('skips shooting splits with no attempts, and the whole line when there are none', () => {
    const noThrees = summary({ shooting: { fgPct: 40, fg2Pct: 40, fg3Pct: null, ftPct: 75 } });
    expect(buildSeasonRecap({ name: 'Ava' }, 'Fall 2026', noThrees).split('\n')[2]).toBe(
      'FG 40% · FT 75%',
    );

    const noShots = summary({ shooting: { fgPct: null, fg2Pct: null, fg3Pct: null, ftPct: null } });
    expect(buildSeasonRecap({ name: 'Ava' }, 'Fall 2026', noShots).split('\n')).toHaveLength(2);
  });

  it('matches summarizeGames for a real season', () => {
    const demo = buildDemoData({ today: '2026-09-28' });
    const season = summarizeGames(statLinesForGames(demo.games, demo.events));
    const [heading, perGame, shooting] = buildSeasonRecap(
      demo.players[0],
      'Fall 2026',
      season,
    ).split('\n');

    expect(heading).toBe('Ava — Fall 2026 (7–3)');
    expect(perGame).toBe(
      [
        `${season.averages.pts.toFixed(1)} PPG`,
        `${season.averages.reb.toFixed(1)} RPG`,
        `${season.averages.ast.toFixed(1)} APG`,
        `${season.averages.stl.toFixed(1)} SPG`,
      ].join(' · '),
    );
    expect(shooting).toMatch(/^FG \d+% · 3PT \d+% · FT \d+%$/);
  });
});
