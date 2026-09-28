import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import type * as Repo from '@/data/repo';
import {
  deleteGame,
  deleteStat,
  getGame,
  getGameEvents,
  recordStat,
  updateGame,
  updateSettings,
} from '@/data/repo';
import { computeStatLine, percentage, statLinesByPeriod } from '@/data/stats';
import { EXPORT_APP, EXPORT_SCHEMA_VERSION, importAll } from '@/data/transfer';
import type { CourtPoint, Game, Player, StatEvent, StatType } from '@/data/types';
import { formatMadeAttempted, formatPct } from '@/lib/format';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import { buildGameRecap } from './recap';

// The real writes, which a test can make fail once with `mockRejectedValueOnce`.
vi.mock('@/data/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof Repo>();
  return {
    ...actual,
    deleteGame: vi.fn(actual.deleteGame),
    updateGame: vi.fn(actual.updateGame),
  };
});

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

/** A stat as [type, period], plus where the shot was taken when that was recorded. */
type Play = [type: StatType, period: number, location?: CourtPoint];

/**
 * In the order they happened: 8 points, 3 rebounds and a bit of everything. No shot
 * has a spot.
 */
const PLAYS: Play[] = [
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
  const events = plays.map(([type, period, location], index) => ({
    id: `e${String(index + 1).padStart(2, '0')}`,
    gameId: game.id,
    type,
    period,
    createdAt: at(18, 5 + index),
    ...(location ? { location } : {}),
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

/** The button that opens or closes a period of the play-by-play, e.g. '2nd quarter'. */
const periodToggle = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}, `) });

/** Taps a play and confirms deleting it. */
async function deletePlay(user: UserEvent, name: RegExp) {
  await user.click(screen.getByRole('button', { name }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete this stat?' });
  await user.click(within(dialog).getByRole('button', { name: 'Delete stat' }));
  await waitForNoDialog();
}

/**
 * Watches the page for any of `texts`, even ones that show for a moment. The
 * returned function stops watching and lists the texts that showed up.
 */
function watchFor(...texts: string[]): () => string[] {
  const seen = new Set<string>();
  const check = (text: string | null) => {
    for (const wanted of texts) if (text?.includes(wanted)) seen.add(wanted);
  };
  const handle = (records: MutationRecord[]) => {
    for (const record of records) {
      check(record.target.textContent);
      record.addedNodes.forEach((node) => check(node.textContent));
    }
  };
  const observer = new MutationObserver(handle);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return () => {
    handle(observer.takeRecords());
    observer.disconnect();
    return [...seen];
  };
}

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

  describe('play-by-play', () => {
    it('sums up each period of a long game, and opens one on a tap', async () => {
      await seed(); // 17 plays: more than a short game's 15
      const { user } = await renderReport();

      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
      for (const [name, summary] of [
        ['1st quarter', '3 plays · 2 pts'],
        ['2nd quarter', '3 plays · 3 pts · 5 total'],
        ['3rd quarter', '3 plays · 1 pt · 6 total'],
        ['4th quarter', '8 plays · 2 pts · 8 total'],
      ] as const) {
        const toggle = periodToggle(name);
        expect(toggle).toHaveAccessibleName(`${name}, ${summary}`);
        expect(toggle).toHaveTextContent(`${name}${summary}`);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
      }
      expect(screen.queryByRole('button', { name: /2PT Made/ })).not.toBeInTheDocument();

      await user.click(periodToggle('2nd quarter'));
      expect(periodToggle('2nd quarter')).toHaveAttribute('aria-expanded', 'true');
      const plays = screen.getByRole('list', { name: '2nd quarter plays' });
      expect(periodToggle('2nd quarter')).toHaveAttribute('aria-controls', plays.id);
      // The time, the stat, and the points it added (only made shots add any).
      const rows = within(plays).getAllByRole('button');
      expect(rows.map((row) => row.textContent)).toEqual([
        '6:083PT Made+3',
        '6:09Assist',
        '6:10Deflection',
      ]);
      expect(rows[0]).toHaveAccessibleName('6:08, 3PT Made, +3 points');
      expect(rows[1]).toHaveAccessibleName('6:09, Assist');
      expect(screen.queryByRole('list', { name: '1st quarter plays' })).not.toBeInTheDocument();

      await user.click(periodToggle('2nd quarter'));
      expect(periodToggle('2nd quarter')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('list', { name: '2nd quarter plays' })).not.toBeInTheDocument();
    });

    it('shows every play of a short game', async () => {
      await seed(makeGame(), PLAYS.slice(0, 15));
      await renderReport();

      for (const name of ['1st quarter', '2nd quarter', '3rd quarter', '4th quarter']) {
        expect(periodToggle(name)).toHaveAttribute('aria-expanded', 'true');
      }
      expect(screen.getAllByRole('button', { name: /^\d{1,2}:\d\d/ })).toHaveLength(15);
      expect(screen.getByRole('button', { name: '6:11, FT Made, +1 point' })).toHaveTextContent(
        '6:11FT Made+1',
      );
    });

    it('links to adding or fixing stats, above the plays', async () => {
      await seed();
      const { user, router } = await renderReport();

      const link = screen.getByRole('link', { name: 'Add or fix stats' });
      expect(
        link.compareDocumentPosition(periodToggle('1st quarter')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      await user.click(link);
      expect(router.state.location.pathname).toBe(paths.trackGame('g1'));
    });

    it('leaves out stat types this version does not know, instead of crashing', async () => {
      await seed(makeGame(), PLAYS.slice(0, 3));
      // As if a newer version of the app had recorded it.
      await db.events.add({
        id: 'from-newer-app',
        gameId: 'g1',
        type: 'tip_in' as StatType,
        period: 1,
        createdAt: at(18, 30),
      });
      await renderReport();

      expect(periodToggle('1st quarter')).toHaveAccessibleName('1st quarter, 3 plays · 2 pts');
      expect(screen.getAllByRole('button', { name: /^\d{1,2}:\d\d/ })).toHaveLength(3);
      expect(tile('Game totals', 'Points').value).toBe('2');
    });

    it('deletes a play after confirming; the numbers follow and focus moves on', async () => {
      await seed();
      const { user } = await renderReport();
      await user.click(periodToggle('2nd quarter'));

      await user.click(screen.getByRole('button', { name: /6:08.*3PT Made/ }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete this stat?' });
      expect(dialog).toHaveAccessibleDescription("3PT Made in Q2 at 6:08. This can't be undone.");
      await user.click(within(dialog).getByRole('button', { name: 'Delete stat' }));

      await waitFor(() => expect(tile('Game totals', 'Points').value).toBe('5'));
      expect((await getGameEvents('g1')).map((event) => event.id)).not.toContain('e04');
      expect(await getGameEvents('g1')).toHaveLength(PLAYS.length - 1);
      expect(notifications()).toHaveTextContent('Deleted 3PT Made');
      expect(periodToggle('2nd quarter')).toHaveAccessibleName(
        '2nd quarter, 2 plays · 0 pts · 2 total',
      );
      // Focus doesn't drop to the page: it goes to the next play.
      expect(screen.getByRole('button', { name: /6:09.*Assist/ })).toHaveFocus();
    });

    it('moves focus to the previous play after deleting a period’s last one', async () => {
      await seed();
      const { user } = await renderReport();
      await user.click(periodToggle('2nd quarter'));

      await deletePlay(user, /6:10.*Deflection/);

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /6:10/ })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('button', { name: /6:09.*Assist/ })).toHaveFocus();
    });

    it('moves focus to the next period, then to the heading, as periods empty out', async () => {
      await seed(makeGame(), [
        ['fg2_made', 1],
        ['ast', 2],
      ]);
      const { user } = await renderReport();

      await deletePlay(user, /6:05.*2PT Made/);
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: /^1st quarter/ })).not.toBeInTheDocument(),
      );
      expect(periodToggle('2nd quarter')).toHaveFocus();

      await deletePlay(user, /6:06.*Assist/);
      expect(await screen.findByText('No stats recorded yet.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Play-by-play' })).toHaveFocus();
    });

    it('says so when the play was deleted elsewhere in the meantime', async () => {
      await seed();
      const { user } = await renderReport();
      await user.click(periodToggle('2nd quarter'));

      await user.click(screen.getByRole('button', { name: /6:08.*3PT Made/ }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete this stat?' });
      await deleteStat('e04');
      await user.click(within(dialog).getByRole('button', { name: 'Delete stat' }));

      expect(
        await within(notifications()).findByText('That stat was already deleted'),
      ).toBeInTheDocument();
      expect(await getGameEvents('g1')).toHaveLength(PLAYS.length - 1);
    });

    it('keeps a play when the deletion is cancelled', async () => {
      await seed();
      const { user } = await renderReport();
      await user.click(periodToggle('2nd quarter'));

      await user.click(screen.getByRole('button', { name: /6:08.*3PT Made/ }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete this stat?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitForNoDialog();

      expect(await getGameEvents('g1')).toHaveLength(PLAYS.length);
      expect(tile('Game totals', 'Points').value).toBe('8');
      expect(screen.getByRole('button', { name: /6:08.*3PT Made/ })).toHaveFocus();
    });
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

  describe('shot chart', () => {
    it('maps the shots that have a spot, and her shooting by zone', async () => {
      await seed(makeGame(), [
        ['fg2_made', 1, { x: 0.5, y: 2 }], // a layup: the paint
        ['fg2_miss', 1, { x: -9, y: 12 }], // an elbow jumper: mid-range
        ['fg3_made', 2, { x: 22, y: -2 }], // a corner three
        ['fg3_miss', 3], // no spot
        ['fg2_made', 4], // no spot
        ['ft_made', 4],
        ['ast', 4],
      ]);
      await renderReport();

      const section = screen.getByRole('region', { name: 'Shot chart' });
      const figure = within(section).getByRole('figure');
      expect(within(figure).getByRole('img')).toHaveAccessibleName(
        /^Shot chart: 3 shots on the map, 2 made \(67%\)\./,
      );
      expect(within(figure).getByText('Made').closest('p')).toHaveTextContent('Made 2 · Missed 1');
      expect(within(figure).getByText('3 of 5 shots have a location')).toBeInTheDocument();

      // Paint, mid-range and 3PT. 3PT counts both threes, like the box score, spot or not.
      const zones = within(screen.getByLabelText('Shooting by zone'));
      expect(zones.getAllByRole('term')).toHaveLength(3);
      expect(zones.getAllByText(/%$/).map((value) => value.textContent)).toEqual([
        '100%',
        '0%',
        '50%',
      ]);
      expect(zones.getAllByText(/ made$/).map((detail) => detail.textContent)).toEqual([
        '1 of 1 made',
        '0 of 1 made',
        '1 of 2 made',
      ]);
    });

    it('says no spots were recorded when the setting asks for them', async () => {
      // Her five shots, none with a spot; the setting is on by default.
      await seed();
      await renderReport();

      const section = screen.getByRole('region', { name: 'Shot chart' });
      expect(section).toHaveTextContent('No shot spots were recorded in this game.');
      expect(within(section).queryByRole('figure')).not.toBeInTheDocument();
    });

    it('leaves the section out when no spot was recorded and the setting is off', async () => {
      await seed();
      await updateSettings({ shotChart: false });
      await renderReport();

      expect(screen.queryByRole('heading', { name: 'Shot chart' })).not.toBeInTheDocument();
      expect(screen.queryByText(/No shot spots/)).not.toBeInTheDocument();
    });

    it('leaves the section out when she took no shots', async () => {
      await seed(makeGame(), [
        ['ft_made', 1],
        ['ft_miss', 1],
        ['ast', 2],
        ['dreb', 3],
      ]);
      await renderReport();

      expect(screen.queryByRole('region', { name: 'Shot chart' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Shot chart' })).not.toBeInTheDocument();
    });
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
      // The current quarter stands out in the table, and says so to screen readers.
      const table = screen.getByRole('table', { name: 'Stats by quarter' });
      expect(
        within(table).getByRole('rowheader', { name: 'Q3, current' }).closest('tr'),
      ).toHaveClass('highlighted');
      expect(within(table).getByRole('rowheader', { name: 'Q2' })).toBeInTheDocument();

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

    it('has no score fields while the game is live, and keeps its stored score', async () => {
      // E.g. a game that was ended with a score, then reopened.
      await seed(makeGame({ status: 'live', currentPeriod: 3, endedAt: undefined }));
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Edit details' }));
      const sheet = screen.getByRole('dialog', { name: 'Edit game' });
      expect(sheet).toHaveAccessibleDescription(
        "You'll add the final score when you end the game.",
      );
      expect(within(sheet).queryByLabelText('Our score')).not.toBeInTheDocument();
      expect(within(sheet).queryByLabelText('Their score')).not.toBeInTheDocument();
      await user.type(within(sheet).getByLabelText('Notes'), 'Up by two at the half.');
      await user.click(within(sheet).getByRole('button', { name: 'Save' }));

      await waitForNoDialog();
      expect(await getGame('g1')).toMatchObject({
        notes: 'Up by two at the half.',
        teamScore: 45,
        opponentScore: 38,
      });
    });

    it('keeps the sheet and what was typed when saving fails, and says so', async () => {
      await seed();
      vi.mocked(updateGame).mockRejectedValueOnce(new Error('Disk full'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { user } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Edit details' }));
      const sheet = screen.getByRole('dialog', { name: 'Edit game' });
      await user.clear(within(sheet).getByLabelText('Opponent'));
      await user.type(within(sheet).getByLabelText('Opponent'), 'Lincoln');
      await user.click(within(sheet).getByRole('button', { name: 'Save' }));

      expect(
        await within(notifications()).findByText("Couldn't save the changes. Try again."),
      ).toBeInTheDocument();
      expect(consoleError).toHaveBeenCalledWith('Saving the game failed', expect.any(Error));
      expect(screen.getByRole('dialog', { name: 'Edit game' })).toBeInTheDocument();
      expect(within(sheet).getByLabelText('Opponent')).toHaveValue('Lincoln');
      expect(await getGame('g1')).toMatchObject({ opponent: 'Central' });

      // Save works again.
      await user.click(within(sheet).getByRole('button', { name: 'Save' }));
      await waitForNoDialog();
      expect(await getGame('g1')).toMatchObject({ opponent: 'Lincoln' });
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
      const stopWatching = watchFor('Game not found', 'Game report');
      await user.click(within(dialog).getByRole('button', { name: 'Delete game' }));

      await waitFor(() => expect(router.state.location.pathname).toBe(paths.home));
      expect(await screen.findByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
      // The report stayed up until Games replaced it: no "not found" or loading on the way.
      expect(stopWatching()).toEqual([]);
      expect(await getGame('g1')).toBeUndefined();
      expect(await getGameEvents('g1')).toEqual([]);
      expect(notifications()).toHaveTextContent('Game deleted');
      // Replaced, so Back doesn't return to the deleted game.
      expect(router.state.historyAction).toBe('REPLACE');
    });

    it('stays on the report, following its data again, when deleting fails', async () => {
      await seed();
      vi.mocked(deleteGame).mockRejectedValueOnce(new Error('Disk full'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { user, router } = await renderReport();

      await user.click(screen.getByRole('button', { name: 'Delete game' }));
      const dialog = screen.getByRole('alertdialog', { name: 'Delete this game?' });
      await user.click(within(dialog).getByRole('button', { name: 'Delete game' }));

      expect(
        await within(notifications()).findByText("Couldn't delete the game. Try again."),
      ).toBeInTheDocument();
      expect(consoleError).toHaveBeenCalledWith('Deleting the game failed', expect.any(Error));
      expect(router.state.location.pathname).toBe(paths.gameReport('g1'));
      expect(await getGame('g1')).toBeDefined();
      // Not frozen on what it showed when the delete began: a new stat shows up.
      await recordStat('g1', 'fg3_made');
      await waitFor(() => expect(tile('Game totals', 'Points').value).toBe('11'));
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
