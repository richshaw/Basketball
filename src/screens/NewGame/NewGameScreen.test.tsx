import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { createGame, listGames, updateSettings, type NewGame } from '@/data/repo';
import { TEXT_LIMITS } from '@/data/types';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';

function addGame(overrides: Partial<NewGame> = {}) {
  return createGame({
    opponent: 'Lincoln',
    date: '2026-09-20',
    periodFormat: 'quarters',
    ...overrides,
  });
}

const opponentField = () => screen.findByLabelText('Opponent');
const startButton = () => screen.getByRole('button', { name: 'Start game' });
const notifications = () => screen.getByRole('status', { name: 'Notifications' });
const TRACK_PATH = /^\/games\/[^/]+\/track$/;

/** The options offered by a field's suggestion list. */
function suggestionsOf(field: HTMLElement): string[] {
  const listId = field.getAttribute('list');
  const options = listId ? document.getElementById(listId)?.querySelectorAll('option') : undefined;
  return [...(options ?? [])].map((option) => option.value);
}

describe('NewGameScreen', () => {
  it('starts from today, a home game, and the season and periods of the last game', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 27, 17, 45) });
    await updateSettings({ defaultPeriodFormat: 'halves', lastSeason: 'JV Winter' });
    renderRoute(paths.newGame);

    expect(await opponentField()).toHaveValue('');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-27');
    expect(screen.getByRole('radio', { name: 'Home' })).toBeChecked();
    expect(screen.getByLabelText('Season or team')).toHaveValue('JV Winter');
    expect(screen.getByRole('radio', { name: 'Halves' })).toBeChecked();
    expect(screen.getByRole('radiogroup', { name: 'Home or away' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Periods' })).toBeInTheDocument();
  });

  it('starts with quarters and no season on a new phone', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 3, 9) });
    renderRoute(paths.newGame);

    await opponentField();
    const season = screen.getByLabelText('Season or team');
    expect(season).toHaveValue('');
    expect(season).toHaveAttribute('placeholder', 'e.g. Fall 2026');
    expect(season).toHaveAccessibleDescription('Optional. Keeps each season’s stats together.');
    expect(screen.getByRole('radio', { name: 'Quarters' })).toBeChecked();
  });

  it('needs an opponent', async () => {
    const { user, router } = renderRoute(paths.newGame);
    const opponent = await opponentField();
    await user.type(opponent, '   ');
    await user.click(startButton());

    expect(opponent).toHaveAccessibleDescription('Enter the other team’s name');
    expect(opponent).toBeInvalid();
    expect(opponent).toHaveFocus();
    expect(router.state.location.pathname).toBe(paths.newGame);
    expect(await listGames()).toEqual([]);

    // The message goes away as soon as there's a name.
    await user.type(opponent, 'Central');
    expect(opponent).toBeValid();
    expect(screen.queryByText('Enter the other team’s name')).not.toBeInTheDocument();
  });

  it('needs a date', async () => {
    const { user } = renderRoute(paths.newGame);
    await user.type(await opponentField(), 'Central');
    const date = screen.getByLabelText('Date');
    fireEvent.change(date, { target: { value: '' } });
    await user.click(startButton());

    expect(date).toHaveAccessibleDescription('Pick the date of the game');
    expect(date).toHaveFocus();
    expect(await listGames()).toEqual([]);
  });

  it('starts the game in place of the form, so Back from the game goes to Games', async () => {
    const { user, router } = renderRoute(paths.home);
    await user.click(await screen.findByRole('link', { name: 'New game' }));

    await user.type(await opponentField(), '  Central Catholic ');
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-26' } });
    await user.click(screen.getByRole('radio', { name: 'Away' }));
    await user.type(screen.getByLabelText('Season or team'), 'Fall 2026');
    await user.click(screen.getByRole('radio', { name: 'Halves' }));
    await user.click(startButton());

    await waitFor(() => expect(router.state.location.pathname).toMatch(TRACK_PATH));
    const games = await listGames();
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      opponent: 'Central Catholic',
      date: '2026-09-26',
      homeAway: 'away',
      season: 'Fall 2026',
      periodFormat: 'halves',
      status: 'live',
      currentPeriod: 1,
    });
    expect(router.state.location.pathname).toBe(paths.trackGame(games[0]?.id ?? ''));
    expect(router.state.historyAction).toBe('REPLACE');

    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe(paths.home);
  });

  it('leaves the season off when the field is empty', async () => {
    await updateSettings({ lastSeason: 'Fall 2026' });
    const { user, router } = renderRoute(paths.newGame);
    await user.type(await opponentField(), 'Central');
    await user.clear(screen.getByLabelText('Season or team'));
    await user.click(startButton());

    await waitFor(() => expect(router.state.location.pathname).toMatch(TRACK_PATH));
    const [game] = await listGames();
    expect(game?.season).toBeUndefined();
    expect(game?.homeAway).toBe('home');
  });

  it('starts just one game however fast Start is tapped', async () => {
    const { user, router } = renderRoute(paths.newGame);
    await user.type(await opponentField(), 'Central');
    fireEvent.click(startButton());
    fireEvent.click(startButton());

    await waitFor(() => expect(router.state.location.pathname).toMatch(TRACK_PATH));
    expect(await listGames()).toHaveLength(1);
  });

  it('closes the keyboard on return instead of starting the game', async () => {
    const { user, router } = renderRoute(paths.newGame);
    const opponent = await opponentField();
    await user.type(opponent, 'Central{Enter}');

    expect(opponent).not.toHaveFocus();
    expect(opponent).toHaveAttribute('enterkeyhint', 'done');
    expect(router.state.location.pathname).toBe(paths.newGame);
    expect(await listGames()).toEqual([]);
  });

  it('suggests past opponents and seasons', async () => {
    await addGame({ opponent: 'Lincoln', date: '2026-06-01', season: 'Summer 2026' });
    await addGame({ opponent: 'Central', date: '2026-09-01', season: 'Fall 2026' });
    await addGame({ opponent: 'lincoln', date: '2026-09-10', season: 'Fall 2026' });
    renderRoute(paths.newGame);

    const opponent = await screen.findByRole('combobox', { name: 'Opponent' });
    await waitFor(() => expect(suggestionsOf(opponent)).toEqual(['lincoln', 'Central']));
    const season = screen.getByRole('combobox', { name: 'Season or team' });
    await waitFor(() => expect(suggestionsOf(season)).toEqual(['Fall 2026', 'Summer 2026']));
  });

  it('keeps names within the stored limits', async () => {
    renderRoute(paths.newGame);
    expect(await opponentField()).toHaveAttribute('maxLength', String(TEXT_LIMITS.opponent));
    expect(screen.getByLabelText('Season or team')).toHaveAttribute(
      'maxLength',
      String(TEXT_LIMITS.season),
    );
  });

  it('points to the game in progress, and can still start another', async () => {
    const live = await addGame({ opponent: 'Eastlake' });
    const { user, router } = renderRoute(paths.newGame);

    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('You have a game in progress vs Eastlake');
    expect(within(note).getByRole('link', { name: 'Resume it' })).toHaveAttribute(
      'href',
      paths.trackGame(live.id),
    );

    await user.type(await opponentField(), 'Westview');
    await user.click(startButton());
    await waitFor(() => expect(router.state.location.pathname).toMatch(TRACK_PATH));
    const liveGames = (await listGames()).filter((game) => game.status === 'live');
    expect(liveGames.map((game) => game.opponent).sort()).toEqual(['Eastlake', 'Westview']);
  });

  it('resumes the game in progress in place of the form', async () => {
    const live = await addGame({ opponent: 'Eastlake' });
    const { user, router } = renderRoute(paths.home);
    await user.click(await screen.findByRole('link', { name: 'New game' }));
    await user.click(await screen.findByRole('link', { name: 'Resume it' }));

    expect(router.state.location.pathname).toBe(paths.trackGame(live.id));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('says so, and allows another try, when the game can’t be saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.games, 'add').mockRejectedValueOnce(new Error('Disk full'));
    const { user, router } = renderRoute(paths.newGame);
    await user.type(await opponentField(), 'Central');
    await user.click(startButton());

    await waitFor(() =>
      expect(notifications()).toHaveTextContent('Couldn’t start the game. Please try again.'),
    );
    expect(router.state.location.pathname).toBe(paths.newGame);
    expect(await listGames()).toEqual([]);

    await user.click(startButton());
    await waitFor(() => expect(router.state.location.pathname).toMatch(TRACK_PATH));
    expect(await listGames()).toHaveLength(1);
  });
});
