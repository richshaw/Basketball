import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import {
  createGame,
  endGame,
  getPlayer,
  recordStat,
  savePlayer,
  setCurrentPeriod,
  type NewGame,
} from '@/data/repo';
import type { Game, StatType } from '@/data/types';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';

interface GameSeed extends Partial<NewGame> {
  /** Stats recorded in order. */
  stats?: StatType[];
  /** Ends the game with this score ([ours, theirs]), or without one ('final'). */
  end?: [number, number] | 'final';
  period?: number;
}

async function addGame({ stats = [], end, period, ...input }: GameSeed = {}): Promise<Game> {
  let game = await createGame({
    opponent: 'Lincoln',
    date: '2026-09-20',
    periodFormat: 'quarters',
    ...input,
  });
  for (const type of stats) await recordStat(game.id, type);
  if (period) game = await setCurrentPeriod(game.id, period);
  if (end === 'final') game = await endGame(game.id);
  else if (end) game = await endGame(game.id, { teamScore: end[0], opponentScore: end[1] });
  return game;
}

const setupCard = () => screen.queryByRole('region', { name: 'Who are you tracking?' });
const newGameLink = () => screen.getByRole('link', { name: 'New game' });
const notifications = () => screen.getByRole('status', { name: 'Notifications' });

/** Whether `a` comes before `b` in the page. */
function isBefore(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('HomeScreen', () => {
  describe('first run', () => {
    it('asks who is being tracked, saves the player and then shows the usual Games', async () => {
      const { user } = renderRoute(paths.home);
      const card = await screen.findByRole('region', { name: 'Who are you tracking?' });

      await user.type(within(card).getByLabelText('Name'), 'Ava');
      await user.type(within(card).getByLabelText('Number'), '12');
      await user.click(within(card).getByRole('button', { name: 'Save' }));

      await waitFor(() => expect(setupCard()).not.toBeInTheDocument());
      expect(await getPlayer()).toMatchObject({ name: 'Ava', jerseyNumber: '12' });
      expect(screen.getByText('Ava · #12')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'No games yet' })).toBeInTheDocument();
      // Focus moves on to the next step instead of getting lost with the card.
      await waitFor(() => expect(newGameLink()).toHaveFocus());
    });

    it('needs a name', async () => {
      const { user } = renderRoute(paths.home);
      const card = await screen.findByRole('region', { name: 'Who are you tracking?' });
      await user.type(within(card).getByLabelText('Number'), '12');
      await user.click(within(card).getByRole('button', { name: 'Save' }));

      const name = within(card).getByLabelText('Name');
      expect(name).toHaveAccessibleDescription('Enter a name');
      expect(name).toBeInvalid();
      expect(name).toHaveFocus();
      expect(await getPlayer()).toBeUndefined();

      await user.type(name, 'Ava');
      expect(name).toBeValid();
    });

    it('moves from the name to the number on return, and saves without a number', async () => {
      const { user } = renderRoute(paths.home);
      const card = await screen.findByRole('region', { name: 'Who are you tracking?' });
      await user.type(within(card).getByLabelText('Name'), '  Ava {Enter}');
      expect(within(card).getByLabelText('Number')).toHaveFocus();
      expect(await getPlayer()).toBeUndefined();

      await user.click(within(card).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(setupCard()).not.toBeInTheDocument());
      const player = await getPlayer();
      expect(player?.name).toBe('Ava');
      expect(player?.jerseyNumber).toBeUndefined();
      expect(screen.getByText('Ava')).toBeInTheDocument();
    });

    it('keeps the form and says so when saving fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(db.players, 'put').mockRejectedValueOnce(new Error('Disk full'));
      const { user } = renderRoute(paths.home);
      const card = await screen.findByRole('region', { name: 'Who are you tracking?' });
      await user.type(within(card).getByLabelText('Name'), 'Ava');
      await user.click(within(card).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(notifications()).toHaveTextContent('Couldn’t save the name. Please try again.'),
      );
      expect(setupCard()).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(await getPlayer()).toBeUndefined();
    });

    it('points to Settings for restoring a backup file (in a build without cloud backup)', async () => {
      const { user, router } = renderRoute(paths.home);
      const card = await screen.findByRole('region', { name: 'Who are you tracking?' });
      await user.click(within(card).getByRole('link', { name: 'Go to Settings' }));
      expect(router.state.location.pathname).toBe(paths.settings);
    });

    it('offers a new phone the restore from a backup code, and back', async () => {
      vi.stubEnv('VITE_BACKUP_API_URL', 'https://backup.hoop-stats.test');
      try {
        const { user, router } = renderRoute(paths.home);
        const card = await screen.findByRole('region', { name: 'Who are you tracking?' });
        expect(card).toHaveTextContent('Setting up a new phone? Restore from a backup');

        await user.click(within(card).getByRole('link', { name: 'Restore from a backup' }));
        expect(router.state.location.pathname).toBe(paths.restoreBackup());
        expect(router.state.location.search).toBe('?from=games');
        expect(
          await screen.findByRole('heading', { level: 1, name: 'Restore from backup' }),
        ).toBeVisible();
        expect(screen.getByLabelText('Backup code')).toBeVisible();

        await user.click(screen.getByRole('link', { name: 'Games' }));
        expect(router.state.location.pathname).toBe(paths.home);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('can start a game before the player is named', async () => {
      const { user, router } = renderRoute(paths.home);
      await screen.findByRole('region', { name: 'Who are you tracking?' });
      expect(screen.getByText('In a hurry? You can add the name later.')).toBeInTheDocument();
      // Save is the main action here, so New game steps back.
      expect(newGameLink()).toHaveClass('secondary');

      await user.click(newGameLink());
      expect(router.state.location.pathname).toBe(paths.newGame);
    });

    it('keeps asking for the name after a game started without one, below the live game', async () => {
      // Starting a game first creates the player with no name.
      await addGame({ opponent: 'Central' });
      const { user } = renderRoute(paths.home);

      const live = await screen.findByRole('region', { name: 'Game in progress' });
      const card = screen.getByRole('region', { name: 'Who are you tracking?' });
      expect(isBefore(live, card)).toBe(true);
      expect(screen.getByRole('link', { name: /vs Central/ })).toBeInTheDocument();

      // Resuming the game stays the one main action; saving the name steps back.
      const resume = within(live).getByRole('link', { name: 'Resume game' });
      const save = within(card).getByRole('button', { name: 'Save' });
      expect(resume).toHaveClass('primary');
      expect(save).toHaveClass('secondary');
      expect(newGameLink()).toHaveClass('secondary');
      expect(screen.queryByText('In a hurry? You can add the name later.')).not.toBeInTheDocument();

      // Once the name is saved, focus goes back to the game.
      await user.type(within(card).getByLabelText('Name'), 'Ava');
      await user.click(save);
      await waitFor(() => expect(setupCard()).not.toBeInTheDocument());
      expect(await getPlayer()).toMatchObject({ name: 'Ava' });
      await waitFor(() => expect(resume).toHaveFocus());
    });
  });

  describe('with a player', () => {
    beforeEach(async () => {
      // Row dates leave out the year only for this year.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 28, 12) });
      await savePlayer({ name: 'Ava', jerseyNumber: '12' });
    });

    it('shows the player beside the title', async () => {
      renderRoute(paths.home);
      expect(await screen.findByText('Ava · #12')).toBeInTheDocument();
      expect(setupCard()).not.toBeInTheDocument();
    });

    it('explains an empty list and offers New game', async () => {
      const { user, router } = renderRoute(paths.home);
      expect(await screen.findByRole('heading', { name: 'No games yet' })).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(newGameLink()).toHaveClass('primary');

      await user.click(newGameLink());
      expect(router.state.location.pathname).toBe(paths.newGame);
    });

    it('lists every game newest first, with the player’s line and the result', async () => {
      const lincoln = await addGame({
        opponent: 'Lincoln',
        date: '2026-09-01',
        homeAway: 'home',
        stats: ['fg2_made', 'fg2_made', 'ft_made', 'dreb'],
        end: [45, 38],
      });
      const central = await addGame({
        opponent: 'Central',
        date: '2026-09-08',
        homeAway: 'away',
        stats: ['fg3_made', 'oreb', 'dreb', 'ast'],
        end: [38, 45],
      });
      await addGame({
        opponent: 'Oak Ridge',
        date: '2026-09-15',
        homeAway: 'neutral',
        end: [40, 40],
      });
      await addGame({ opponent: 'Westview', date: '2025-12-12', end: 'final' });
      const { user, router } = renderRoute(paths.home);

      // No seasons at all: one list, no section headers.
      const list = await screen.findByRole('list', { name: 'Games' });
      expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
      const rows = within(list).getAllByRole('link');
      expect(rows).toHaveLength(4);

      expect(rows[0]).toHaveTextContent(/^vs Oak RidgeTue, Sep 15T 40–40/);
      expect(rows[1]).toHaveTextContent(/^@ CentralTue, Sep 8L 38–45.*3 PTS · 2 REB/);
      expect(rows[2]).toHaveTextContent(/^vs LincolnTue, Sep 1W 45–38.*5 PTS · 1 REB/);
      // Last year's game shows its year; with no final score it just says Final.
      expect(rows[3]).toHaveTextContent(/^vs WestviewFri, Dec 12, 2025Final.*0 PTS · 0 REB/);

      // Screen readers hear the result and line in words.
      expect(rows[2]).toHaveAccessibleName(/Won 45 to 38, 5 points, 1 rebound$/);
      expect(rows[1]).toHaveAccessibleName(/Lost 38 to 45, 3 points, 2 rebounds$/);

      expect(rows[2]).toHaveAttribute('href', paths.gameReport(lincoln.id));
      await user.click(screen.getByRole('link', { name: /@ Central/ }));
      expect(router.state.location.pathname).toBe(paths.gameReport(central.id));
    });

    it('puts the live game first, with the running line and a way back in', async () => {
      await addGame({ opponent: 'Lincoln', date: '2026-09-20', end: [50, 40] });
      const live = await addGame({
        opponent: 'Eastlake',
        date: '2026-09-28',
        homeAway: 'away',
        season: 'Fall 2026',
        stats: ['fg3_made', 'fg2_made', 'ast', 'dreb', 'oreb'],
        period: 3,
      });
      const { user, router } = renderRoute(paths.home);

      const card = await screen.findByRole('region', { name: 'Game in progress' });
      expect(card).toHaveTextContent('@ Eastlake');
      expect(card).toHaveTextContent('Q3');
      expect(card).toHaveTextContent('Mon, Sep 28 · Fall 2026');
      const stats = within(card).getByLabelText('Stats so far');
      expect(
        within(stats)
          .getAllByRole('term')
          .map((term) => term.textContent),
      ).toEqual(['PTSPoints', 'REBRebounds', 'ASTAssists']);
      expect(
        within(stats)
          .getAllByRole('definition')
          .map((value) => value.textContent),
      ).toEqual(['5', '2', '1']);

      // It comes before everything else, and Resume is the main action.
      expect(isBefore(card, newGameLink())).toBe(true);
      expect(newGameLink()).toHaveClass('secondary');

      // The list marks it live and resumes it too.
      const row = screen.getByRole('link', { name: /@ Eastlake/ });
      expect(row).toHaveTextContent('Live');
      expect(row).toHaveTextContent('5 PTS · 2 REB');
      expect(row).toHaveAttribute('href', paths.trackGame(live.id));

      await user.click(within(card).getByRole('link', { name: 'Resume game' }));
      expect(router.state.location.pathname).toBe(paths.trackGame(live.id));
    });

    it('splits the list by season, the current season first', async () => {
      await addGame({ opponent: 'Early', date: '2026-01-10', end: 'final' });
      await addGame({
        opponent: 'Summer A',
        date: '2026-06-10',
        season: 'Summer 2026',
        end: [1, 0],
      });
      await addGame({ opponent: 'Fall A', date: '2026-09-10', season: 'Fall 2026', end: [2, 1] });
      await addGame({
        opponent: 'Summer B',
        date: '2026-07-10',
        season: 'Summer 2026',
        end: [3, 2],
      });
      await addGame({ opponent: 'Fall B', date: '2026-09-20', season: 'Fall 2026', end: [4, 3] });
      renderRoute(paths.home);

      const headings = await screen.findAllByRole('heading', { level: 2 });
      expect(headings.map((heading) => heading.textContent)).toEqual([
        'Fall 2026',
        'Summer 2026',
        'No season',
      ]);
      const titles = (season: string) =>
        within(screen.getByRole('list', { name: season }))
          .getAllByRole('link')
          .map((row) => row.textContent?.split(/(?=[A-Z][a-z]{2}, )/)[0]);
      expect(titles('Fall 2026')).toEqual(['vs Fall B', 'vs Fall A']);
      expect(titles('Summer 2026')).toEqual(['vs Summer B', 'vs Summer A']);
      expect(titles('No season')).toEqual(['vs Early']);
    });

    it('heads the list with the season even when there is just one', async () => {
      await addGame({ opponent: 'Fall A', date: '2026-09-10', season: 'Fall 2026', end: [2, 1] });
      renderRoute(paths.home);

      const list = await screen.findByRole('list', { name: 'Fall 2026' });
      expect(within(list).getByRole('link')).toHaveTextContent(/^vs Fall AThu, Sep 10W 2–1/);
    });

    it('stays hidden until the data is in', async () => {
      const { container } = renderRoute(paths.home);
      expect(container.querySelector('[aria-busy="true"]')).toContainElement(newGameLink());
      await screen.findByRole('heading', { name: 'No games yet' });
      expect(container.querySelector('[aria-busy]')).not.toBeInTheDocument();
    });

    it('shows the live game and New game without waiting to read every stat', async () => {
      const live = await addGame({ opponent: 'Eastlake', date: '2026-09-28', stats: ['fg3_made'] });
      await addGame({ opponent: 'Lincoln', date: '2026-09-01', stats: ['ast'], end: [40, 30] });
      // Reading every event of every game (for the list's lines) never finishes here.
      vi.spyOn(db.events, 'orderBy').mockReturnValue({
        toArray: () => new Promise(() => {}),
      } as unknown as ReturnType<typeof db.events.orderBy>);
      const { container } = renderRoute(paths.home);

      const card = await screen.findByRole('region', { name: 'Game in progress' });
      expect(within(card).getAllByRole('definition')[0]).toHaveTextContent('3');
      expect(within(card).getByRole('link', { name: 'Resume game' })).toHaveAttribute(
        'href',
        paths.trackGame(live.id),
      );
      expect(newGameLink()).toBeInTheDocument();

      // Only the list, below everything else, is still waiting.
      const busy = container.querySelectorAll('[aria-busy="true"]');
      expect(busy).toHaveLength(1);
      expect(busy[0]).not.toContainElement(card);
      expect(isBefore(newGameLink(), busy[0] as Element)).toBe(true);
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('fills in the list once every stat is read', async () => {
      await addGame({ opponent: 'Lincoln', date: '2026-09-01', stats: ['ast'], end: [40, 30] });
      const { container } = renderRoute(paths.home);

      const list = await screen.findByRole('list', { name: 'Games' });
      expect(within(list).getByRole('link')).toHaveTextContent('0 PTS · 0 REB');
      expect(container.querySelector('[aria-busy]')).not.toBeInTheDocument();
    });
  });
});
