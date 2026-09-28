import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getGame, getGameEvents } from '@/data/repo';
import { computeStatLine, percentage, statLinesByPeriod } from '@/data/stats';
import { EXPORT_APP, EXPORT_SCHEMA_VERSION, importAll } from '@/data/transfer';
import type { Game, Player, StatEvent, StatType } from '@/data/types';
import { formatMadeAttempted, formatPct } from '@/lib/format';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import { buildGameRecap } from './recap';

const PLAYER: Player = { id: 'p1', name: 'Ava', jerseyNumber: '12', createdAt: 1, updatedAt: 1 };

/** Local time on the game day (Sun, Sep 27, 2026). */
function at(hour: number, minute: number): number {
  return new Date(2026, 8, 27, hour, minute).getTime();
}

/** A final home win over Central, 45–38. */
function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    playerId: PLAYER.id,
    opponent: 'Central',
    date: '2026-09-27',
    season: 'Fall 2026',
    homeAway: 'home',
    periodFormat: 'quarters',
    currentPeriod: 4,
    status: 'final',
    teamScore: 45,
    opponentScore: 38,
    createdAt: at(17, 40),
    updatedAt: at(19, 30),
    endedAt: at(19, 30),
    ...overrides,
  };
}

/** [type, period] in the order they happened: 8 points, 3 rebounds and a bit of everything. */
const PLAYS: [StatType, number][] = [
  ['fg2_made', 1],
  ['fg3_miss', 1],
  ['dreb', 1],
  ['fg3_made', 2],
  ['ast', 2],
  ['deflection', 2],
  ['ft_made', 3],
  ['ft_miss', 3],
  ['stl', 3],
  ['fg2_made', 4],
  ['blk', 4],
  ['tov', 4],
  ['foul', 4],
  ['oreb', 4],
  ['fg2_miss', 4],
  ['charge', 4],
  ['dreb', 4],
];

/** Stores the player, `game` and its plays (one a minute from 6:05), replacing everything. */
async function seed(game: Game = makeGame(), plays = PLAYS): Promise<StatEvent[]> {
  const events = plays.map(([type, period], index) => ({
    id: `e${String(index + 1).padStart(2, '0')}`,
    gameId: game.id,
    type,
    period,
    createdAt: at(18, 5 + index),
  }));
  await importAll(
    {
      app: EXPORT_APP,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date(at(20, 0)).toISOString(),
      players: [PLAYER],
      games: [game],
      events,
    },
    'replace',
  );
  return events;
}

/** Renders the report of `gameId` and waits until it has loaded. */
async function renderReport(gameId = 'g1') {
  const view = renderRoute(paths.gameReport(gameId));
  await screen.findByRole('heading', { level: 2, name: 'Play-by-play' });
  return view;
}

/** The value and detail of the tile with this full label, in the tile grid named `grid`. */
function tile(grid: string, fullLabel: string) {
  const term = within(screen.getByLabelText(grid)).getByText(fullLabel).closest('dt');
  if (!term?.parentElement) throw new Error(`No ${fullLabel} tile in ${grid}`);
  const [value, detail] = within(term.parentElement).getAllByRole('definition');
  return { value: value?.textContent, detail: detail?.textContent ?? null };
}

function hustleRow(title: string) {
  const list = screen.getByRole('list', { name: 'Hustle and more' });
  return within(list).getByText(title).closest('li');
}

const notifications = () => screen.getByRole('status', { name: 'Notifications' });

const waitForNoDialog = () =>
  waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

afterEach(() => {
  delete (navigator as { share?: unknown }).share;
});

describe('GameReportScreen', () => {
  it('shows the matchup, date, season and result', async () => {
    await seed();
    await renderReport();

    expect(screen.getByRole('heading', { level: 1, name: 'vs Central' })).toBeInTheDocument();
    expect(screen.getByText('Sun, Sep 27, 2026 · Fall 2026')).toBeInTheDocument();
    expect(screen.getByText('Won').closest('p')).toHaveTextContent('Won 45–38');
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
  });

  it.each([
    [{ homeAway: 'away', teamScore: 38, opponentScore: 45 }, '@ Central', 'Lost 38–45'],
    [{ homeAway: 'neutral', teamScore: 40, opponentScore: 40 }, 'vs Central', 'Tied 40–40'],
  ] as const)('shows an away loss or a tie: %o', async (overrides, title, result) => {
    await seed(makeGame(overrides));
    await renderReport();

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(result.split(' ')[0] ?? '').closest('p')).toHaveTextContent(result);
  });

  it('says so when no score was entered, and offers to add one', async () => {
    await seed(makeGame({ teamScore: undefined, opponentScore: undefined }));
    const { user } = await renderReport();

    expect(screen.getByText('No score entered')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add score' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit game' });
    expect(within(sheet).getByLabelText('Our score')).toHaveFocus();
  });

  it('names the missing score when only one was entered', async () => {
    await seed(makeGame({ opponentScore: undefined }));
    const { user } = await renderReport();

    expect(screen.getByText('Their score is missing')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add score' }));
    const sheet = screen.getByRole('dialog', { name: 'Edit game' });
    expect(within(sheet).getByLabelText('Their score')).toHaveFocus();
  });

  it('shows her numbers, matching her stat line', async () => {
    const events = await seed();
    await renderReport();
    const line = computeStatLine(events);

    expect(tile('Game totals', 'Points')).toEqual({
      value: String(line.pts),
      detail: `${line.fgm}/${line.fga} FG`,
    });
    expect(tile('Game totals', 'Rebounds')).toEqual({
      value: String(line.reb),
      detail: `${line.oreb} off · ${line.dreb} def`,
    });
    for (const [label, value] of [
      ['Assists', line.ast],
      ['Steals', line.stl],
      ['Blocks', line.blk],
      ['Turnovers', line.tov],
    ] as const) {
      expect(tile('Game totals', label)).toEqual({ value: String(value), detail: null });
    }
    // 8 points: a two, a three, a free throw and another two.
    expect(line.pts).toBe(8);

    for (const [label, made, attempted] of [
      ['Field goal percentage', line.fgm, line.fga],
      ['Two-point percentage', line.fg2m, line.fg2a],
      ['Three-point percentage', line.fg3m, line.fg3a],
      ['Free throw percentage', line.ftm, line.fta],
    ] as const) {
      const shooting = tile('Shooting percentages', label);
      expect(shooting.value).toBe(formatPct(percentage(made, attempted)));
      expect(shooting.detail).toContain(formatMadeAttempted(made, attempted));
      expect(shooting.detail).toContain(`${made} of ${attempted} made`);
    }

    expect(hustleRow('Deflections')).toHaveTextContent(`Deflections${line.deflections}`);
    expect(hustleRow('Charges taken')).toHaveTextContent(`Charges taken${line.charges}`);
    expect(hustleRow('Fouls')).toHaveTextContent(`Fouls${line.pf}`);
    expect(screen.queryByText('Fouled out')).not.toBeInTheDocument();
  });

  it('shows a dash for shots she never took', async () => {
    await seed(makeGame(), [['ast', 1]]);
    await renderReport();

    expect(tile('Shooting percentages', 'Three-point percentage').value).toBe('–');
    expect(tile('Game totals', 'Points')).toEqual({ value: '0', detail: null });
    expect(tile('Game totals', 'Rebounds')).toEqual({ value: '0', detail: null });
  });

  it('flags five fouls as fouled out', async () => {
    await seed(makeGame(), [
      ['foul', 1],
      ['foul', 2],
      ['foul', 3],
      ['foul', 3],
      ['foul', 4],
    ]);
    await renderReport();

    expect(hustleRow('Fouls')).toHaveTextContent('FoulsFouled out5');
  });

  it('splits her numbers by quarter, with a total row', async () => {
    const events = await seed();
    await renderReport();

    const table = screen.getByRole('table', { name: 'Stats by quarter' });
    const rows = within(table).getAllByRole('row');
    expect(rows.map((row) => within(row).queryByRole('rowheader')?.textContent)).toEqual([
      undefined,
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Total',
    ]);
    const [q1] = statLinesByPeriod(events, makeGame());
    expect(
      within(rows[1] as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([String(q1?.line.pts), '1/2', '0/1', '0/0', '1', '0', '0', '0', '0', '0']);
    const total = computeStatLine(events);
    expect(
      within(rows[5] as HTMLElement)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(
      [
        total.pts,
        '3/5',
        '1/2',
        '1/2',
        total.reb,
        total.ast,
        total.stl,
        total.blk,
        total.tov,
        total.pf,
      ].map(String),
    );
  });

  it('adds a row for each overtime, and splits halves', async () => {
    const overtime = makeGame({ currentPeriod: 6 });
    await seed(overtime, [
      ['fg2_made', 1],
      ['fg3_made', 5],
      ['ft_made', 6],
    ]);
    const { unmount } = await renderReport();

    const table = screen.getByRole('table', { name: 'Stats by quarter' });
    const labels = within(table)
      .getAllByRole('rowheader')
      .map((header) => header.textContent);
    expect(labels).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'OT', '2OT', 'Total']);
    const ot = within(table).getByRole('rowheader', { name: 'OT' }).closest('tr');
    expect(within(ot as HTMLElement).getAllByRole('cell')[0]).toHaveTextContent('3');
    unmount();

    await seed(makeGame({ periodFormat: 'halves', currentPeriod: 2 }), [['fg2_made', 2]]);
    await renderReport();
    const halves = screen.getByRole('table', { name: 'Stats by half' });
    expect(
      within(halves)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(['H1', 'H2', 'Total']);
    expect(screen.getByRole('heading', { level: 2, name: 'By half' })).toBeInTheDocument();
  });

  it('lists every play by period, with the time and her running points', async () => {
    await seed();
    await renderReport();

    const periods = screen
      .getAllByRole('heading', { level: 3 })
      .map((heading) => heading.textContent);
    expect(periods).toEqual(['1st quarter', '2nd quarter', '3rd quarter', '4th quarter']);

    const firstQuarter = screen.getByRole('list', { name: '1st quarter' });
    expect(
      within(firstQuarter)
        .getAllByRole('button')
        .map((row) => row.textContent),
    ).toEqual(['6:052PT Made2 pts', '6:063PT Miss2 pts', '6:07Def Reb2 pts']);
    const thirdQuarter = screen.getByRole('list', { name: '3rd quarter' });
    expect(within(thirdQuarter).getAllByRole('button')[0]).toHaveTextContent('6:11FT Made6 pts');
    const lastPlay = screen.getAllByRole('button', { name: /Def Reb/ }).at(-1);
    expect(lastPlay).toHaveTextContent('6:21Def Reb8 pts');
  });

  it('deletes a play after confirming, and the numbers follow', async () => {
    await seed();
    const { user } = await renderReport();

    await user.click(screen.getByRole('button', { name: /6:08.*3PT Made/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this stat?' });
    expect(dialog).toHaveAccessibleDescription("3PT Made in Q2 at 6:08. This can't be undone.");
    await user.click(within(dialog).getByRole('button', { name: 'Delete stat' }));

    await waitFor(async () => {
      expect((await getGameEvents('g1')).map((event) => event.id)).not.toContain('e04');
    });
    expect(await getGameEvents('g1')).toHaveLength(PLAYS.length - 1);
    await waitFor(() => expect(tile('Game totals', 'Points').value).toBe('5'));
    expect(notifications()).toHaveTextContent('Deleted 3PT Made');
  });

  it('keeps a play when the deletion is cancelled', async () => {
    await seed();
    const { user } = await renderReport();

    await user.click(screen.getByRole('button', { name: /6:08.*3PT Made/ }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this stat?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitForNoDialog();

    expect(await getGameEvents('g1')).toHaveLength(PLAYS.length);
    expect(tile('Game totals', 'Points').value).toBe('8');
  });

  it('shows the notes, when there are some', async () => {
    await seed(makeGame({ notes: 'Great defense.\nCoach loved the hustle.' }));
    const { unmount } = await renderReport();
    const notes = screen.getByRole('region', { name: 'Notes' });
    expect(notes).toHaveTextContent('Great defense. Coach loved the hustle.', {
      normalizeWhitespace: true,
    });
    unmount();

    await seed(makeGame());
    await renderReport();
    expect(screen.queryByRole('region', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('keeps a spot for the shot chart', async () => {
    await seed();
    await renderReport();
    expect(screen.getByRole('region', { name: 'Shot chart' })).toBeInTheDocument();
  });

  it('links to adding or fixing stats on the tracking screen', async () => {
    await seed();
    const { user, router } = await renderReport();

    await user.click(screen.getByRole('link', { name: 'Add or fix stats' }));
    expect(router.state.location.pathname).toBe(paths.trackGame('g1'));
  });

  describe('a live game', () => {
    it('is in progress, with a way back to tracking', async () => {
      await seed(
        makeGame({
          status: 'live',
          currentPeriod: 3,
          teamScore: undefined,
          opponentScore: undefined,
          endedAt: undefined,
        }),
      );
      const { user, router } = await renderReport();

      expect(screen.getByText('In progress').closest('p')).toHaveTextContent(
        'In progress3rd quarter',
      );
      expect(screen.queryByText('No score entered')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Add or fix stats' })).not.toBeInTheDocument();
      // The current quarter stands out in the table.
      const table = screen.getByRole('table', { name: 'Stats by quarter' });
      expect(within(table).getByRole('rowheader', { name: 'Q3' }).closest('tr')).toHaveClass(
        'highlighted',
      );

      await user.click(screen.getByRole('link', { name: 'Resume tracking' }));
      expect(router.state.location.pathname).toBe(paths.trackGame('g1'));
    });
  });

  describe('sharing', () => {
    it('copies the recap when there is no share sheet', async () => {
      const events = await seed();
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Share recap' }));

      expect(await within(notifications()).findByText('Copied')).toBeInTheDocument();
      const recap = buildGameRecap(PLAYER, makeGame(), computeStatLine(events));
      expect(await navigator.clipboard.readText()).toBe(recap);
      expect(recap).toBe(
        [
          'Ava vs Central — Won 45–38 (Sun, Sep 27)',
          '8 PTS · 3 REB · 1 AST · 1 STL · 1 BLK',
          'FG 3/5 · 3PT 1/2 · FT 1/2',
          '1 deflection · 1 charge taken',
        ].join('\n'),
      );
    });

    it('opens the share sheet when there is one', async () => {
      const share = (_data: ShareData) => Promise.resolve();
      const calls: ShareData[] = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data: ShareData) => {
          calls.push(data);
          return share(data);
        },
      });
      await seed();
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Share recap' }));

      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toEqual({
        title: 'Ava vs Central',
        text: expect.stringMatching(/^Ava vs Central — Won 45–38 \(Sun, Sep 27\)\n8 PTS/) as string,
      });
      expect(notifications()).toBeEmptyDOMElement();
    });
  });

  describe('editing', () => {
    it('saves new details', async () => {
      await seed();
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Edit details' }));
      const sheet = screen.getByRole('dialog', { name: 'Edit game' });
      const opponent = within(sheet).getByLabelText('Opponent');
      expect(opponent).toHaveValue('Central');
      await user.clear(opponent);
      await user.type(opponent, 'Central Catholic');
      await user.click(within(sheet).getByRole('radio', { name: 'Away' }));
      await user.clear(within(sheet).getByLabelText('Our score'));
      await user.type(within(sheet).getByLabelText('Our score'), '50');
      await user.clear(within(sheet).getByLabelText('Season'));
      await user.type(within(sheet).getByLabelText('Notes'), 'Loud gym.');
      await user.click(within(sheet).getByRole('button', { name: 'Save' }));

      await waitForNoDialog();
      expect(notifications()).toHaveTextContent('Changes saved');
      const saved = await getGame('g1');
      expect(saved).toMatchObject({
        opponent: 'Central Catholic',
        homeAway: 'away',
        teamScore: 50,
        opponentScore: 38,
        notes: 'Loud gym.',
      });
      expect(saved?.season).toBeUndefined();
      expect(
        await screen.findByRole('heading', { level: 1, name: '@ Central Catholic' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Won').closest('p')).toHaveTextContent('Won 50–38');
    });

    it('clears the score when the fields are emptied', async () => {
      await seed();
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Edit details' }));
      const sheet = screen.getByRole('dialog', { name: 'Edit game' });
      await user.clear(within(sheet).getByLabelText('Our score'));
      await user.clear(within(sheet).getByLabelText('Their score'));
      await user.click(within(sheet).getByRole('button', { name: 'Save' }));

      await waitForNoDialog();
      const saved = await getGame('g1');
      expect(saved?.teamScore).toBeUndefined();
      expect(saved?.opponentScore).toBeUndefined();
      expect(await screen.findByText('No score entered')).toBeInTheDocument();
    });

    it('needs an opponent and a valid score before saving', async () => {
      await seed();
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Edit details' }));
      const sheet = screen.getByRole('dialog', { name: 'Edit game' });
      await user.clear(within(sheet).getByLabelText('Opponent'));
      await user.clear(within(sheet).getByLabelText('Their score'));
      await user.type(within(sheet).getByLabelText('Their score'), '4.5');
      await user.click(within(sheet).getByRole('button', { name: 'Save' }));

      expect(within(sheet).getByLabelText('Opponent')).toHaveAccessibleDescription(
        'Enter the opponent',
      );
      expect(within(sheet).getByLabelText('Opponent')).toHaveFocus();
      expect(within(sheet).getByLabelText('Their score')).toHaveAccessibleDescription(
        'Enter a number from 0 to 999',
      );
      expect(screen.getByRole('dialog', { name: 'Edit game' })).toBeInTheDocument();
      expect(await getGame('g1')).toMatchObject({ opponent: 'Central', opponentScore: 38 });

      // Fixing a field clears its message.
      await user.type(within(sheet).getByLabelText('Opponent'), 'Lincoln');
      expect(within(sheet).getByLabelText('Opponent')).not.toHaveAccessibleDescription();
    });

    it('changes nothing on Cancel', async () => {
      await seed();
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Edit details' }));
      const sheet = screen.getByRole('dialog', { name: 'Edit game' });
      await user.clear(within(sheet).getByLabelText('Opponent'));
      await user.type(within(sheet).getByLabelText('Opponent'), 'Somebody else');
      await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));

      await waitForNoDialog();
      expect(await getGame('g1')).toMatchObject({ opponent: 'Central' });

      // Opening it again starts from the saved details.
      await user.click(screen.getByRole('button', { name: 'Edit details' }));
      expect(
        within(screen.getByRole('dialog', { name: 'Edit game' })).getByLabelText('Opponent'),
      ).toHaveValue('Central');
    });
  });

  describe('deleting the game', () => {
    it('asks first, then deletes it and goes back to Games', async () => {
      await seed();
      const { user, router } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Delete game' }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete this game?' });
      expect(dialog).toHaveAccessibleDescription(
        `The game against Central on Sun, Sep 27 and all ${PLAYS.length} of its stats will be gone for good.`,
      );
      await user.click(within(dialog).getByRole('button', { name: 'Delete game' }));

      // The report stays up (never "not found") until Games replaces it.
      await waitFor(() => expect(router.state.location.pathname).toBe(paths.home));
      expect(await getGame('g1')).toBeUndefined();
      expect(await getGameEvents('g1')).toEqual([]);
      expect(await screen.findByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
      expect(screen.queryByText('Game not found')).not.toBeInTheDocument();
      expect(notifications()).toHaveTextContent('Game deleted');
      // Replaced, so Back doesn't return to the deleted game.
      expect(router.state.historyAction).toBe('REPLACE');
    });

    it('keeps it when cancelled', async () => {
      await seed();
      const { user, router } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Delete game' }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete this game?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitForNoDialog();

      expect(router.state.location.pathname).toBe(paths.gameReport('g1'));
      expect(await getGame('g1')).toBeDefined();
    });
  });

  it('says so when there is no such game', async () => {
    const { user, router } = renderRoute(paths.gameReport('nope'));

    expect(await screen.findByRole('heading', { name: 'Game not found' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Game report' })).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Go to Games' }));
    expect(router.state.location.pathname).toBe(paths.home);
  });
});
