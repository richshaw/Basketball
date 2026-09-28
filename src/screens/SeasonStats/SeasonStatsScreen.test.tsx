import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDemoData, DEMO_LIVE_GAME_ID, demoGameId, type DemoOptions } from '@/data/demo';
import {
  createGame,
  endGame,
  getAllEvents,
  listGames,
  recordStat,
  updateSettings,
} from '@/data/repo';
import { countShots, hasLocation, shotsFromEvents } from '@/data/shots';
import {
  HIGH_STATS,
  statLinesForGames,
  summarizeGames,
  type GamesSummary,
  type HighStat,
} from '@/data/stats';
import { importAll, type ExportFile } from '@/data/transfer';
import type { CourtPoint, Game, StatEvent, StatType } from '@/data/types';
import { formatAvg, formatGameDate, formatMadeAttempted, formatPct } from '@/lib/format';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import { gameTitle } from '@/lib/gameTitle';
import { clearSessionValues } from './seasonFilter';
import { buildSeasonRecap } from './seasonRecap';

const TODAY = '2026-09-28';

async function seedDemo(options: DemoOptions = {}): Promise<ExportFile> {
  const demo = buildDemoData({ today: TODAY, ...options });
  await importAll(demo, 'replace');
  return demo;
}

/** What the screen should show: summarizeGames over the final games (of one season). */
function expectedSummary(games: readonly Game[], events: ExportFile['events'], season?: string) {
  const finals = games.filter(
    (game) => game.status === 'final' && (season === undefined || game.season === season),
  );
  return summarizeGames(statLinesForGames(finals, events));
}

/** A stat to record: its type, or a shot's type and where it was taken. */
type Stat = StatType | [StatType, CourtPoint];

/** Adds a finished game: its stats, then the final score. */
async function addFinalGame(
  input: { opponent: string; date: string; season?: string },
  stats: Stat[],
  [teamScore, opponentScore]: [number, number],
): Promise<Game> {
  const game = await createGame({ ...input, periodFormat: 'quarters' });
  for (const stat of stats) {
    const [type, location] = Array.isArray(stat) ? stat : [stat];
    await recordStat(game.id, type, location);
  }
  return endGame(game.id, { teamScore, opponentScore });
}

/** Waits for the stats to load. (By text: polling role queries over the whole page is slow.) */
const waitForStats = () => screen.findByText('Averages', { selector: 'h2' });

/** The shot chart's legend for these stats: makes and misses of the shots with a spot. */
function expectedLegend(events: readonly StatEvent[]): string {
  const { made, attempted } = countShots(shotsFromEvents(events).filter(hasLocation));
  return `Made ${made} · Missed ${attempted - made}`;
}

/** The legend of the shot map named `caption`, e.g. 'Fall 2026 · 10 games'. */
function shotMapLegend(caption: string) {
  const chart = screen.getByRole('region', { name: 'Shot chart' });
  const map = within(chart).getByRole('figure', { name: caption });
  return within(map).getByText('Made').closest('p');
}

/** The number on the average tile with this full label, e.g. 'Points per game'. */
function tileValue(fullLabel: string, grid = screen.getByLabelText('Averages per game')) {
  const tile = within(grid).getByText(fullLabel).closest('div');
  if (!tile) throw new Error(`No tile for ${fullLabel}`);
  return within(tile).getAllByRole('definition')[0]?.textContent;
}

function expectAverages({ averages, shooting }: GamesSummary) {
  const grid = screen.getByLabelText('Averages per game');
  expect({
    ppg: tileValue('Points per game', grid),
    rpg: tileValue('Rebounds per game', grid),
    apg: tileValue('Assists per game', grid),
    spg: tileValue('Steals per game', grid),
    bpg: tileValue('Blocks per game', grid),
    topg: tileValue('Turnovers per game', grid),
    fg: tileValue('Field goal percentage', grid),
    fg3: tileValue('Three-point percentage', grid),
    ft: tileValue('Free throw percentage', grid),
  }).toEqual({
    ppg: formatAvg(averages.pts),
    rpg: formatAvg(averages.reb),
    apg: formatAvg(averages.ast),
    spg: formatAvg(averages.stl),
    bpg: formatAvg(averages.blk),
    topg: formatAvg(averages.tov),
    fg: formatPct(shooting.fgPct),
    fg3: formatPct(shooting.fg3Pct),
    ft: formatPct(shooting.ftPct),
  });
}

/** The cell under `header` in the one row of the Totals table. */
function totalsCell(header: string): string | null | undefined {
  const table = screen.getByRole('table', { name: 'Totals' });
  const headers = within(table).getAllByRole('columnheader');
  const column = headers.findIndex((cell) => within(cell).queryByText(header, { exact: true }));
  const [, row] = within(table).getAllByRole('row');
  if (!row) throw new Error('No totals row');
  const cells = [...within(row).getAllByRole('rowheader'), ...within(row).getAllByRole('cell')];
  return cells[column]?.textContent;
}

beforeEach(() => {
  clearSessionValues();
});

// Each test renders the whole app over a season of games, so give it room on a busy machine.
describe('SeasonStatsScreen', { timeout: 15_000 }, () => {
  describe('with the demo season', () => {
    let demo: ExportFile;

    beforeEach(async () => {
      demo = await seedDemo();
    });

    it('shows the record, games played and averages that summarizeGames computes', async () => {
      renderRoute(paths.stats);
      await waitForStats();

      const expected = expectedSummary(demo.games, demo.events);
      expect(expected.gamesPlayed).toBe(10);
      expectAverages(expected);
      expect(screen.getByText('Ava')).toBeInTheDocument();
      // The summary's line (the shot chart's caption repeats it).
      expect(screen.getByText('Fall 2026 · 10 games', { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText('Record')).toBeInTheDocument();
      expect(screen.getByText('7–3')).toBeInTheDocument();

      // Shooting tiles show the made/attempted totals too.
      const { totals } = expected;
      const averages = screen.getByLabelText('Averages per game');
      expect(
        within(averages).getByText(formatMadeAttempted(totals.fgm, totals.fga)),
      ).toBeInTheDocument();
      expect(totalsCell('PTS')).toBe(String(totals.pts));
      expect(totalsCell('GP')).toBe('10');
    });

    it('lists season highs, each opening the game it came from', async () => {
      const { user, router } = renderRoute(paths.stats);
      await waitForStats();
      const highs = screen.getByRole('list', { name: 'Season highs' });

      const expected = expectedSummary(demo.games, demo.events);
      const labels: Record<HighStat, string> = {
        pts: 'Points',
        reb: 'Rebounds',
        ast: 'Assists',
        stl: 'Steals',
        blk: 'Blocks',
        deflections: 'Deflections',
      };
      for (const stat of HIGH_STATS) {
        const high = expected.highs[stat];
        if (!high) throw new Error(`The demo season has no ${stat} high`);
        const game = demo.games.find((candidate) => candidate.id === high.gameId);
        if (!game) throw new Error(`Missing game ${high.gameId}`);
        const link = within(highs).getByRole('link', {
          name: new RegExp(`^${labels[stat]}: ${high.value},`),
        });
        expect(link).toHaveAttribute('href', paths.gameReport(game.id));
        expect(link).toHaveTextContent(`${gameTitle(game)} · ${formatGameDate(game.date)}`);
      }

      await user.click(within(highs).getByRole('link', { name: /^Points:/ }));
      expect(router.state.location.pathname).toBe(
        paths.gameReport(expected.highs.pts?.gameId ?? ''),
      );
    });

    it('switches seasons, and the numbers follow', async () => {
      const summerOpener = await addFinalGame(
        { opponent: 'Harbor', date: '2026-06-10', season: 'Summer 2026' },
        ['fg3_made', 'fg3_made', 'fg3_made', 'dreb', 'dreb', 'ast', 'stl'],
        [40, 32],
      );
      await addFinalGame(
        { opponent: 'Bayside', date: '2026-06-20', season: 'Summer 2026' },
        ['fg2_made', 'fg2_made', 'ft_made', 'ft_miss', 'oreb', 'blk', 'tov'],
        [28, 35],
      );
      const { user } = renderRoute(paths.stats);
      await waitForStats();

      // The most recent season comes first.
      const seasons = screen.getByRole('radiogroup', { name: 'Season' });
      expect(
        within(seasons)
          .getAllByRole('radio')
          .map((radio) => radio.textContent),
      ).toEqual(['All', 'Fall 2026', 'Summer 2026']);
      expect(within(seasons).getByRole('radio', { name: 'Fall 2026' })).toBeChecked();
      expectAverages(expectedSummary(demo.games, demo.events, 'Fall 2026'));

      await user.click(within(seasons).getByRole('radio', { name: 'Summer 2026' }));
      const allGames = await listGames();
      const allEvents = await getAllEvents();
      const summer = expectedSummary(allGames, allEvents, 'Summer 2026');
      expect(summer.averages.pts).toBe(7);
      await waitFor(() => expectAverages(summer));
      expect(screen.getByText('Summer 2026 · 2 games')).toBeInTheDocument();
      expect(screen.getByText('1–1')).toBeInTheDocument();
      expect(
        within(screen.getByRole('list', { name: 'Season highs' })).getByRole('link', {
          name: /^Points: 9,/,
        }),
      ).toHaveAttribute('href', paths.gameReport(summerOpener.id));

      await user.click(within(seasons).getByRole('radio', { name: 'All' }));
      await waitFor(() => expectAverages(expectedSummary(allGames, allEvents)));
      expect(screen.getByText('All seasons · 12 games', { selector: 'p' })).toBeInTheDocument();
      expect(screen.getByText('8–4')).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Career highs' })).toBeInTheDocument();
      expect(totalsCell('Season')).toBe('All seasons');
    });

    it('remembers the chosen season while the app stays open', async () => {
      await addFinalGame(
        { opponent: 'Harbor', date: '2026-06-10', season: 'Summer 2026' },
        ['fg2_made'],
        [40, 32],
      );
      const { user } = renderRoute(paths.stats);
      await waitForStats();
      await user.click(screen.getByRole('radio', { name: 'Summer 2026' }));
      expect(await screen.findByText('Summer 2026 · 1 game')).toBeInTheDocument();

      const tabs = screen.getByRole('navigation', { name: 'Main' });
      await user.click(within(tabs).getByRole('link', { name: 'Games' }));
      await user.click(within(tabs).getByRole('link', { name: 'Stats' }));
      await waitForStats();
      expect(screen.getByRole('radio', { name: 'Summer 2026' })).toBeChecked();
      expect(screen.getByText('Summer 2026 · 1 game')).toBeInTheDocument();
    });

    it('lists the games newest first, and a tap anywhere on a row opens its report', async () => {
      const { user, router } = renderRoute(paths.stats);
      const log = await screen.findByRole('table', { name: 'Game log' });

      const rows = within(log).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(10);
      const links = rows.map((row) => within(row).getByRole('link').getAttribute('href'));
      expect(links).toEqual(
        Array.from({ length: 10 }, (_, index) => paths.gameReport(demoGameId(10 - index))),
      );

      // The newest game's line.
      const newest = demo.games.find((game) => game.id === demoGameId(10));
      if (!newest) throw new Error('Missing the newest demo game');
      const [line] = statLinesForGames([newest], demo.events);
      const [first] = rows;
      if (!first || !line) throw new Error('Missing the first row');
      expect(within(first).getByRole('rowheader')).toHaveTextContent(
        `${gameTitle(newest)}, ${formatGameDate(newest.date)}`,
      );
      expect(
        within(first)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ).toEqual([
        `W ${newest.teamScore}–${newest.opponentScore}`,
        String(line.line.pts),
        String(line.line.reb),
        String(line.line.ast),
        String(line.line.stl),
        String(line.line.blk),
        String(line.line.tov),
        String(line.line.pf),
        formatMadeAttempted(line.line.fgm, line.line.fga),
        formatMadeAttempted(line.line.fg3m, line.line.fg3a),
        formatMadeAttempted(line.line.ftm, line.line.fta),
      ]);

      const third = rows[2];
      if (!third) throw new Error('Missing the third row');
      await user.click(within(third).getAllByRole('cell')[1] as HTMLElement);
      expect(router.state.location.pathname).toBe(paths.gameReport(demoGameId(8)));
    });

    it('charts points by default and switches to rebounds or assists', async () => {
      const { user } = renderRoute(paths.stats);
      const chart = await screen.findByRole('group', { name: 'Points by game' });
      const expected = expectedSummary(demo.games, demo.events);

      const bars = within(chart).getAllByRole('button');
      expect(bars).toHaveLength(10);
      const oldest = demo.games[0];
      const [oldestLine] = statLinesForGames(demo.games.slice(0, 1), demo.events);
      if (!oldest || !oldestLine) throw new Error('Missing the oldest demo game');
      // Oldest on the left.
      expect(bars[0]).toHaveAccessibleName(
        `${formatGameDate(oldest.date)}, ${gameTitle(oldest)}: ${oldestLine.line.pts} points`,
      );
      expect(screen.getByText('points per game')).toBeInTheDocument();
      expect(
        screen.getByText(formatAvg(expected.averages.pts), { selector: 'span' }),
      ).toBeVisible();

      await user.click(screen.getByRole('radio', { name: 'Rebounds' }));
      const rebounds = screen.getByRole('group', { name: 'Rebounds by game' });
      expect(within(rebounds).getAllByRole('button')[0]).toHaveAccessibleName(
        new RegExp(`: ${oldestLine.line.reb} rebounds?$`),
      );
      expect(screen.getByText('rebounds per game')).toBeInTheDocument();
      expect(rebounds).toHaveAccessibleDescription(
        new RegExp(
          `^Rebounds in 10 games, .*Average ${formatAvg(expected.averages.reb)} a game\\.`,
        ),
      );

      await user.click(screen.getByRole('radio', { name: 'Assists' }));
      expect(screen.getByRole('group', { name: 'Assists by game' })).toBeInTheDocument();
      expect(screen.getByText('assists per game')).toBeInTheDocument();
    });

    it('reads one game from the chart on a tap, and lets go on a second tap', async () => {
      const { user, router } = renderRoute(paths.stats);
      const chart = await screen.findByRole('group', { name: 'Points by game' });
      const game = demo.games[2];
      const [entry] = statLinesForGames(demo.games.slice(2, 3), demo.events);
      if (!game || !entry) throw new Error('Missing the third demo game');

      const bar = within(chart).getAllByRole('button')[2] as HTMLElement;
      await user.click(bar);
      expect(bar).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByText(`${gameTitle(game)} · L ${game.teamScore}–${game.opponentScore}`),
      ).toBeInTheDocument();
      const report = screen.getByRole('link', { name: /^Game report, / });
      expect(report).toHaveAttribute('href', paths.gameReport(game.id));
      expect(screen.queryByText('Average')).not.toBeInTheDocument();

      await user.click(bar);
      expect(bar).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Average')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^Game report, / })).not.toBeInTheDocument();

      await user.click(bar);
      await user.click(screen.getByRole('link', { name: /^Game report, / }));
      expect(router.state.location.pathname).toBe(paths.gameReport(game.id));
      expect(entry.line.pts).toBeGreaterThan(0);
    });

    it('scrubs through the games with a sideways drag, while a scroll selects nothing', async () => {
      renderRoute(paths.stats);
      const chart = await screen.findByRole('group', { name: 'Points by game' });
      // jsdom has no layout: the chart's ten columns are 30px wide each.
      vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 300,
        bottom: 196,
        width: 300,
        height: 196,
        toJSON: () => ({}),
      });
      const bars = within(chart).getAllByRole('button');
      const second = bars[1] as HTMLElement;
      const pressed = () => bars.filter((bar) => bar.getAttribute('aria-pressed') === 'true');
      const touch = (pointerId: number, clientX: number, clientY = 100) => ({
        pointerId,
        pointerType: 'touch',
        clientX,
        clientY,
      });

      // A finger that lands on the chart and scrolls the page.
      fireEvent.pointerDown(second, touch(1, 45));
      fireEvent.pointerCancel(second, touch(1, 45));
      expect(pressed()).toEqual([]);

      // A swipe that drifts sideways but mostly goes down scrolls too: it never scrubs,
      // even once it has moved far enough sideways.
      fireEvent.pointerDown(second, touch(7, 45, 100));
      fireEvent.pointerMove(second, touch(7, 51, 108));
      fireEvent.pointerMove(second, touch(7, 100, 112));
      fireEvent.pointerUp(second, touch(7, 100, 112));
      expect(pressed()).toEqual([]);

      // A small wobble is still a tap...
      fireEvent.pointerDown(second, touch(2, 45));
      fireEvent.pointerMove(second, touch(2, 48));
      expect(pressed()).toEqual([]);
      // ...but sliding sideways reads each game on the way.
      fireEvent.pointerMove(second, touch(2, 100));
      expect(pressed()).toEqual([bars[3]]);
      fireEvent.pointerMove(second, touch(2, 140));
      fireEvent.pointerUp(second, touch(2, 140));
      expect(pressed()).toEqual([bars[4]]);

      // Dragging off the end stops at the last game.
      fireEvent.pointerDown(second, touch(3, 45));
      fireEvent.pointerMove(second, touch(3, 900));
      fireEvent.pointerUp(second, touch(3, 900));
      expect(pressed()).toEqual([bars[9]]);

      // A short scrub that stays on its game keeps it, even if the browser then clicks.
      fireEvent.pointerDown(second, touch(4, 35, 100));
      fireEvent.pointerMove(second, touch(4, 43, 104));
      fireEvent.pointerUp(second, touch(4, 43, 104));
      fireEvent.click(second, { detail: 1 });
      expect(pressed()).toEqual([bars[1]]);
    });

    it('reads a bar once for a screen reader double tap (a press and a click)', async () => {
      renderRoute(paths.stats);
      const chart = await screen.findByRole('group', { name: 'Points by game' });
      const bar = within(chart).getAllByRole('button')[2] as HTMLElement;
      const doubleTap = (pointerId: number) => {
        const point = { pointerId, pointerType: 'touch', clientX: 75, clientY: 100 };
        fireEvent.pointerDown(bar, point);
        fireEvent.pointerUp(bar, point);
        fireEvent.click(bar, { detail: 0 });
      };

      doubleTap(1);
      expect(bar).toHaveAttribute('aria-pressed', 'true');
      doubleTap(2);
      expect(bar).toHaveAttribute('aria-pressed', 'false');
    });

    it('moves through the chart with the arrow keys', async () => {
      const { user } = renderRoute(paths.stats);
      const chart = await screen.findByRole('group', { name: 'Points by game' });
      const bars = within(chart).getAllByRole('button');

      // One tab stop, the newest game, right after the stat picker. Focus reads it out.
      expect(bars.filter((bar) => bar.tabIndex === 0)).toEqual([bars[9]]);
      act(() => screen.getByRole('radio', { name: 'Points' }).focus());
      await user.tab();
      expect(bars[9]).toHaveFocus();
      expect(bars[9]).toHaveAttribute('aria-pressed', 'true');

      await user.keyboard('{ArrowLeft}');
      expect(bars[8]).toHaveFocus();
      expect(bars[8]).toHaveAttribute('aria-pressed', 'true');
      expect(bars[9]).toHaveAttribute('aria-pressed', 'false');

      await user.keyboard('{Home}');
      expect(bars[0]).toHaveFocus();
      expect(bars[0]).toHaveAttribute('aria-pressed', 'true');

      await user.keyboard('{Escape}');
      expect(bars[0]).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Average')).toBeInTheDocument();

      await user.keyboard('{Enter}');
      expect(bars[0]).toHaveAttribute('aria-pressed', 'true');
    });

    it('shares a season recap, copying it when there is no share sheet', async () => {
      const { user } = renderRoute(paths.stats);
      await waitForStats();
      // No share sheet in jsdom, so the recap goes to user-event's stand-in clipboard.
      expect('share' in navigator).toBe(false);
      const writeText = vi.spyOn(navigator.clipboard, 'writeText');

      await user.click(screen.getByRole('button', { name: 'Share' }));
      const expected = buildSeasonRecap(
        demo.players[0],
        'Fall 2026',
        expectedSummary(demo.games, demo.events),
      );
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
      expect(expected.split('\n')[0]).toBe('Ava — Fall 2026 (7–3)');
      const toasts = screen.getByRole('status', { name: 'Notifications' });
      expect(await within(toasts).findByText('Copied')).toBeInTheDocument();
    });

    it('maps the shots of the games shown, and follows the season picked', async () => {
      // A summer game: a layup in and a corner three out, plus a two with no spot.
      await addFinalGame(
        { opponent: 'Harbor', date: '2026-06-10', season: 'Summer 2026' },
        [['fg2_made', { x: 0, y: 2 }], ['fg3_miss', { x: -22, y: -1 }], 'fg2_miss', 'ft_made'],
        [40, 32],
      );
      const { user } = renderRoute(paths.stats);
      await waitForStats();

      expect(shotMapLegend('Fall 2026 · 10 games')).toHaveTextContent(expectedLegend(demo.events));

      await user.click(screen.getByRole('radio', { name: 'Summer 2026' }));
      await waitFor(() =>
        expect(shotMapLegend('Summer 2026 · 1 game')).toHaveTextContent('Made 1 · Missed 1'),
      );
      expect(screen.getByText('2 of 3 shots have a location')).toBeInTheDocument();
      // Paint, mid-range and 3PT: the summer game's shots alone.
      expect(
        within(screen.getByLabelText('Shooting by zone'))
          .getAllByText(/ made$/)
          .map((detail) => detail.textContent),
      ).toEqual(['1 of 1 made', '0 of 0 made', '0 of 1 made']);

      await user.click(screen.getByRole('radio', { name: 'All' }));
      const allEvents = await getAllEvents();
      await waitFor(() =>
        expect(shotMapLegend('All seasons · 11 games')).toHaveTextContent(
          expectedLegend(allEvents),
        ),
      );
      expect(expectedLegend(allEvents)).not.toBe(expectedLegend(demo.events));
    });
  });

  describe('with a game in progress', () => {
    let demo: ExportFile;

    beforeEach(async () => {
      demo = await seedDemo({ liveGame: true });
    });

    it('leaves games in progress out of every number, and says so', async () => {
      renderRoute(paths.stats);
      await waitForStats();

      const finalOnly = expectedSummary(demo.games, demo.events);
      const withLive = summarizeGames(statLinesForGames(demo.games, demo.events));
      expect(withLive.totals.pts).toBeGreaterThan(finalOnly.totals.pts);

      expectAverages(finalOnly);
      expect(screen.getByText('Fall 2026 · 10 games', { selector: 'p' })).toBeInTheDocument();
      expect(totalsCell('PTS')).toBe(String(finalOnly.totals.pts));
      // Nor are its shots on the shot chart.
      const finalEvents = demo.events.filter((event) => event.gameId !== DEMO_LIVE_GAME_ID);
      expect(expectedLegend(demo.events)).not.toBe(expectedLegend(finalEvents));
      expect(shotMapLegend('Fall 2026 · 10 games')).toHaveTextContent(expectedLegend(finalEvents));
      expect(
        within(screen.getByRole('table', { name: 'Game log' })).getAllByRole('row'),
      ).toHaveLength(
        11, // the header and ten final games
      );
      expect(screen.queryByRole('link', { name: /Westfield/ })).not.toBeInTheDocument();
      expect(
        screen.getByText(
          'The game against Westfield is still in progress. It counts once it’s final.',
        ),
      ).toBeInTheDocument();
    });
  });

  describe('with more seasons than fit a segmented control', () => {
    beforeEach(async () => {
      for (const [season, date, points] of [
        ['Winter', '2026-01-10', 2],
        ['Spring', '2026-04-10', 4],
        ['Summer', '2026-06-10', 6],
        ['Fall', '2026-09-10', 8],
      ] as const) {
        await addFinalGame(
          { opponent: `${season} Opponent`, date, season },
          Array.from({ length: points / 2 }, () => 'fg2_made' as const),
          [30, 20],
        );
      }
    });

    it('picks the season from a sheet when there are too many to fit', async () => {
      const { user } = renderRoute(paths.stats);
      await waitForStats();

      expect(screen.queryByRole('radiogroup', { name: 'Season' })).not.toBeInTheDocument();
      const picker = screen.getByRole('button', { name: /^Season/ });
      expect(picker).toHaveTextContent('Fall');
      expect(tileValue('Points per game')).toBe('8.0');

      await user.click(picker);
      const sheet = await screen.findByRole('dialog', { name: 'Season' });
      const choices = within(sheet).getByRole('list', { name: 'Seasons' });
      expect(
        within(choices)
          .getAllByRole('button')
          .map((button) => button.textContent),
      ).toEqual(['All', 'Fall(selected)', 'Summer', 'Spring', 'Winter']);

      await user.click(within(sheet).getByRole('button', { name: 'Spring' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: /^Season/ })).toHaveTextContent('Spring');
      expect(tileValue('Points per game')).toBe('4.0');
    });
  });

  describe('with games of their own', () => {
    it('uses the sheet for season names too long for a segment', async () => {
      await addFinalGame(
        { opponent: 'Harbor', date: '2026-06-10', season: 'Varsity Summer League' },
        ['fg2_made'],
        [30, 20],
      );
      await addFinalGame(
        { opponent: 'Bayside', date: '2026-09-10', season: 'JV Fall' },
        [],
        [30, 20],
      );
      renderRoute(paths.stats);
      await waitForStats();

      expect(screen.queryByRole('radiogroup', { name: 'Season' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Season/ })).toHaveTextContent('JV Fall');
    });

    it('keeps a long season name from pushing the totals out of view', async () => {
      const season = 'Westside Warriors 12U Spring 2026';
      await addFinalGame(
        { opponent: 'Harbor', date: '2026-04-10', season },
        ['fg2_made'],
        [30, 20],
      );
      renderRoute(paths.stats);
      await waitForStats();

      // The name is in full above the numbers; in the table it's capped with an ellipsis
      // (the CSS), and screen readers still hear all of it.
      expect(screen.getByText(`${season} · 1 game`)).toBeInTheDocument();
      const label = within(screen.getByRole('table', { name: 'Totals' })).getByRole('rowheader', {
        name: season,
      });
      expect(label.firstElementChild).toHaveClass('totalsLabel');
      expect(totalsCell('PTS')).toBe('2');
    });

    it('says when no shot spots were recorded, or leaves the shot chart out with them off', async () => {
      await addFinalGame(
        { opponent: 'Harbor', date: '2026-06-10' },
        ['fg2_made', 'fg3_miss'],
        [30, 20],
      );
      renderRoute(paths.stats);
      await waitForStats();

      const chart = screen.getByRole('region', { name: 'Shot chart' });
      expect(chart).toHaveTextContent('No shot spots were recorded for these games.');
      expect(within(chart).queryByRole('figure')).not.toBeInTheDocument();

      // Turned off in Settings: no empty shot chart at all.
      await updateSettings({ shotChart: false });
      await waitFor(() => expect(screen.queryByText(/No shot spots/)).not.toBeInTheDocument());
      expect(screen.queryByRole('heading', { name: 'Shot chart' })).not.toBeInTheDocument();
    });

    it('shows all games, with no season picker, when no game has a season', async () => {
      await addFinalGame({ opponent: 'Harbor', date: '2026-06-10' }, ['fg3_made'], [30, 20]);
      renderRoute(paths.stats);
      await waitForStats();

      expect(screen.queryByRole('radiogroup', { name: 'Season' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Season/ })).not.toBeInTheDocument();
      expect(screen.getByText('1 game')).toBeInTheDocument();
      expect(tileValue('Points per game')).toBe('3.0');
    });

    it('dates the chart axis with years when the games span New Year', async () => {
      await addFinalGame({ opponent: 'Harbor', date: '2025-12-12' }, ['fg2_made'], [30, 20]);
      await addFinalGame({ opponent: 'Bayside', date: '2026-01-10' }, ['fg3_made'], [30, 20]);
      const { container } = renderRoute(paths.stats);
      await screen.findByRole('group', { name: 'Points by game' });

      const axisText = [...container.querySelectorAll('svg text')].map((text) => text.textContent);
      expect(axisText).toEqual(expect.arrayContaining(['Dec 12, 2025', 'Jan 10, 2026']));
      expect(screen.getByText('2 games · Dec 12, 2025 – Jan 10, 2026')).toBeInTheDocument();
    });

    it('gives every date its year once the games shown span more than one year', async () => {
      // A year apart, against the same team, on the same weekday: only the year tells them apart.
      await addFinalGame(
        { opponent: 'Lincoln', date: '2025-09-13', season: 'Fall 2025' },
        ['fg2_made'],
        [30, 20],
      );
      await addFinalGame(
        { opponent: 'Lincoln', date: '2026-09-12', season: 'Fall 2026' },
        ['fg3_made'],
        [30, 20],
      );
      const { user } = renderRoute(paths.stats);
      await waitForStats();
      const logHeaders = () =>
        within(screen.getByRole('table', { name: 'Game log' }))
          .getAllByRole('rowheader')
          .map((header) => header.textContent);
      const pointsHigh = (list: string) =>
        within(screen.getByRole('list', { name: list })).getByRole('link', {
          name: /^Points: 3,/,
        });

      // One season in one year: no years.
      expect(logHeaders()).toEqual(['vs Lincoln, Sat, Sep 12']);
      expect(
        within(pointsHigh('Season highs')).getByText('vs Lincoln · Sat, Sep 12'),
      ).toBeVisible();

      await user.click(screen.getByRole('radio', { name: 'All' }));
      await waitFor(() =>
        expect(logHeaders()).toEqual([
          'vs Lincoln, Sat, Sep 12, 2026',
          'vs Lincoln, Sat, Sep 13, 2025',
        ]),
      );
      expect(
        within(pointsHigh('Career highs')).getByText('vs Lincoln · Sat, Sep 12, 2026'),
      ).toBeVisible();

      const chart = screen.getByRole('group', { name: 'Points by game' });
      const bars = within(chart).getAllByRole('button');
      expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
        'Sat, Sep 13, 2025, vs Lincoln: 2 points',
        'Sat, Sep 12, 2026, vs Lincoln: 3 points',
      ]);
      expect(chart).toHaveAccessibleDescription(
        'Points in 2 games, Sep 13, 2025 – Sep 12, 2026. Average 2.5 a game. ' +
          'High 3 vs Lincoln on Sat, Sep 12, 2026. Low 2 vs Lincoln on Sat, Sep 13, 2025.',
      );
      expect(screen.getByText('2 games · Sep 13, 2025 – Sep 12, 2026')).toBeInTheDocument();

      await user.click(bars[0] as HTMLElement);
      expect(screen.getByText('Sat, Sep 13, 2025', { selector: 'p' })).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Game report, vs Lincoln, Sat, Sep 13, 2025' }),
      ).toBeInTheDocument();
    });
  });

  describe('before any game is finished', () => {
    it('points back to the game in progress updated most recently, like Games does', async () => {
      const today = await createGame({
        opponent: 'Westfield',
        date: TODAY,
        periodFormat: 'quarters',
      });
      const earlier = await createGame({
        opponent: 'Harbor',
        date: '2026-09-20',
        periodFormat: 'quarters',
      });
      await recordStat(today.id, 'fg2_made');
      await recordStat(earlier.id, 'ast');
      renderRoute(paths.stats);

      expect(await screen.findByRole('link', { name: 'Back to the game' })).toHaveAttribute(
        'href',
        paths.trackGame(earlier.id),
      );
      expect(screen.getByText(/The game against Harbor is still going/)).toBeInTheDocument();
    });

    it('invites the parent to start a game when there are no stats yet', async () => {
      renderRoute(paths.stats);
      expect(await screen.findByRole('heading', { name: 'No stats yet' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Start a game' })).toHaveAttribute(
        'href',
        paths.newGame,
      );
      expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument();
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    });

    it('points back to the game in progress when it is the only one', async () => {
      const live = await createGame({
        opponent: 'Westfield',
        date: TODAY,
        season: 'Fall 2026',
        periodFormat: 'quarters',
      });
      await recordStat(live.id, 'fg2_made');
      renderRoute(paths.stats);

      expect(
        await screen.findByRole('heading', { name: 'No finished games yet' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/The game against Westfield is still going/)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to the game' })).toHaveAttribute(
        'href',
        paths.trackGame(live.id),
      );
    });
  });
});
