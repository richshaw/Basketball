import { describe, expect, it } from 'vitest';
import { buildDemoData } from '@/data/demo';
import { computeStatLine } from '@/data/stats';
import type { Game, StatEvent, StatType } from '@/data/types';
import { buildGamesCsv, CSV_BOM, csvField, GAMES_CSV_HEADERS } from './gamesCsv';

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerId: 'p1',
    opponent: 'Lincoln',
    date: '2026-09-20',
    season: 'Fall 2026',
    homeAway: 'home',
    periodFormat: 'quarters',
    currentPeriod: 4,
    status: 'final',
    teamScore: 44,
    opponentScore: 39,
    createdAt: 1000,
    updatedAt: 2000,
    endedAt: 2000,
    ...overrides,
  };
}

function events(gameId: string, types: StatType[]): Pick<StatEvent, 'gameId' | 'type'>[] {
  return types.map((type) => ({ gameId, type }));
}

/** The CSV's lines without the BOM and the final line ending. */
function lines(csv: string): string[] {
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(CSV_BOM.length, -2).split('\r\n');
}

const HEADER =
  'Date,Opponent,Home/Away,Season,Result,Our score,Their score,PTS,FGM,FGA,3PM,3PA,FTM,FTA,OREB,DREB,REB,AST,STL,BLK,TO,PF,DEFL,CHG';

describe('buildGamesCsv', () => {
  it('starts with a UTF-8 byte order mark and a header row', () => {
    const csv = buildGamesCsv([], []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(lines(csv)).toEqual([HEADER]);
    expect(GAMES_CSV_HEADERS.join(',')).toBe(HEADER);
  });

  it('writes one row per final game with its result, scores and box score', () => {
    const csv = buildGamesCsv(
      [game()],
      events('g1', [
        'fg2_made',
        'fg2_made',
        'fg2_miss',
        'fg3_made',
        'fg3_miss',
        'ft_made',
        'ft_miss',
        'oreb',
        'dreb',
        'dreb',
        'ast',
        'stl',
        'blk',
        'tov',
        'foul',
        'deflection',
        'charge',
      ]),
    );
    expect(lines(csv)).toEqual([
      HEADER,
      // PTS = 2+2+3+1; FG counts 2s and 3s, never free throws.
      '2026-09-20,Lincoln,Home,Fall 2026,W,44,39,8,3,5,1,2,1,2,1,2,3,1,1,1,1,1,1,1',
    ]);
  });

  it('leaves out live games and orders the rest oldest first', () => {
    const csv = buildGamesCsv(
      [
        game({ id: 'late', opponent: 'Eastlake', date: '2026-09-27' }),
        game({ id: 'live', opponent: 'Westfield', date: '2026-09-28', status: 'live' }),
        game({ id: 'early-2', opponent: 'Roosevelt', date: '2026-09-13', createdAt: 5 }),
        game({ id: 'early-1', opponent: 'Central', date: '2026-09-13', createdAt: 4 }),
      ],
      [],
    );
    expect(lines(csv).map((line) => line.split(',')[1])).toEqual([
      'Opponent',
      'Central',
      'Roosevelt',
      'Eastlake',
    ]);
  });

  it('counts each game only its own stats', () => {
    const csv = buildGamesCsv(
      [game({ id: 'a', date: '2026-09-01' }), game({ id: 'b', date: '2026-09-02' })],
      [...events('a', ['fg3_made']), ...events('b', ['ft_made', 'ft_made'])],
    );
    const points = lines(csv)
      .slice(1)
      .map((line) => line.split(',')[7]);
    expect(points).toEqual(['3', '2']);
  });

  it('leaves unknown details blank: venue, season, scores and result', () => {
    const csv = buildGamesCsv(
      [
        game({
          homeAway: undefined,
          season: undefined,
          teamScore: undefined,
          opponentScore: undefined,
        }),
      ],
      [],
    );
    expect(lines(csv)[1]).toBe('2026-09-20,Lincoln,,,,,,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0');
  });

  it('labels away and neutral games and shows losses and ties', () => {
    const csv = buildGamesCsv(
      [
        game({ id: 'a', date: '2026-09-01', homeAway: 'away', teamScore: 30, opponentScore: 41 }),
        game({
          id: 'b',
          date: '2026-09-02',
          homeAway: 'neutral',
          teamScore: 40,
          opponentScore: 40,
        }),
      ],
      [],
    );
    expect(
      lines(csv)
        .slice(1)
        .map((line) => line.split(',').slice(2, 7)),
    ).toEqual([
      ['Away', 'Fall 2026', 'L', '30', '41'],
      ['Neutral', 'Fall 2026', 'T', '40', '40'],
    ]);
  });

  it('quotes text with commas, quotes and line breaks', () => {
    const csv = buildGamesCsv(
      [game({ opponent: 'St. Mary\'s "Lady Knights", Varsity', season: 'Fall\n2026' })],
      [],
    );
    expect(csv).toContain(
      '2026-09-20,"St. Mary\'s ""Lady Knights"", Varsity",Home,"Fall\n2026",W,44,39,',
    );
  });

  it('keeps accented names intact', () => {
    const csv = buildGamesCsv([game({ opponent: 'Zoë Académie' })], []);
    expect(lines(csv)[1]).toContain(',Zoë Académie,');
  });

  it('matches the stats math for a full demo season', () => {
    const demo = buildDemoData({ today: '2026-09-28' });
    const rows = lines(buildGamesCsv(demo.games, demo.events)).slice(1);
    expect(rows).toHaveLength(10);
    const newest = demo.games.at(-1);
    if (!newest) throw new Error('No demo games');
    const line = computeStatLine(demo.events.filter((event) => event.gameId === newest.id));
    const fields = rows.at(-1)?.split(',') ?? [];
    expect(fields.slice(0, 2)).toEqual([newest.date, newest.opponent]);
    expect(fields.slice(7).map(Number)).toEqual([
      line.pts,
      line.fgm,
      line.fga,
      line.fg3m,
      line.fg3a,
      line.ftm,
      line.fta,
      line.oreb,
      line.dreb,
      line.reb,
      line.ast,
      line.stl,
      line.blk,
      line.tov,
      line.pf,
      line.deflections,
      line.charges,
    ]);
  });
});

describe('csvField', () => {
  it('writes numbers as plain digits and blanks for missing values', () => {
    expect(csvField(0)).toBe('0');
    expect(csvField(42)).toBe('42');
    expect(csvField(undefined)).toBe('');
    expect(csvField(Number.NaN)).toBe('');
  });

  it('leaves plain text alone', () => {
    expect(csvField("St. Mary's")).toBe("St. Mary's");
    expect(csvField('')).toBe('');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('cr\rlf')).toBe('"cr\rlf"');
  });

  it('keeps spreadsheets from running text as a formula', () => {
    expect(csvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-Tigers')).toBe("'-Tigers");
    expect(csvField('@home')).toBe("'@home");
    // Numbers are numbers, even negative ones.
    expect(csvField(-3)).toBe('-3');
  });
});
