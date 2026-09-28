import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as repo from '@/data/repo';
import {
  createGame,
  endGame,
  getGame,
  getGameEvents,
  recordStat,
  setCurrentPeriod,
  type NewGame,
} from '@/data/repo';
import { MAX_PERIOD, type Game, type StatType } from '@/data/types';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';

function newGame(overrides: Partial<NewGame> = {}): Promise<Game> {
  return createGame({
    opponent: 'Central',
    date: '2026-09-27',
    homeAway: 'home',
    periodFormat: 'quarters',
    ...overrides,
  });
}

/** Renders the live game screen for `game` and waits until it's showing. */
async function renderTracking(game: Game) {
  const view = renderRoute(paths.trackGame(game.id));
  await screen.findByRole('group', { name: 'Record a stat' });
  return view;
}

const grid = () => screen.getByRole('group', { name: 'Record a stat' });
const statButton = (name: string) => within(grid()).getByRole('button', { name });
const strip = () => screen.getByRole('list', { name: 'Game stats' });
const lastAction = () => screen.getByRole('status', { name: 'Last action' });
const notifications = () => screen.getByRole('status', { name: 'Notifications' });

/** Waits until the stat strip says `text` (what a screen reader hears), e.g. 'Points: 5'. */
async function expectStrip(...texts: string[]) {
  await waitFor(() => {
    for (const text of texts) expect(within(strip()).getByText(text)).toBeInTheDocument();
  });
}

async function eventTypes(gameId: string): Promise<StatType[]> {
  return (await getGameEvents(gameId)).map((event) => event.type);
}

describe('TrackGameScreen', () => {
  it('shows the matchup, the period, empty stats and every stat button', async () => {
    const game = await newGame();
    await renderTracking(game);

    expect(screen.getByRole('heading', { level: 1, name: 'vs Central' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Period Q1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next period' })).toBeEnabled();
    await expectStrip(
      'Points: 0',
      'Rebounds: 0',
      'Assists: 0',
      'Steals: 0',
      'Blocks: 0',
      'Turnovers: 0',
      'Fouls: 0',
      'Field goals: 0 of 0',
      '3-pointers: 0 of 0',
      'Free throws: 0 of 0',
    );
    expect(
      within(grid())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      '2PT Made',
      '2PT Miss',
      '3PT Made',
      '3PT Miss',
      'FT Made',
      'FT Miss',
      'Off Reb',
      'Def Reb',
      'Assist',
      'Steal',
      'Block',
      'Turnover',
      'Foul',
      'Deflection',
      'Charge Taken',
      'Undo',
    ]);
    expect(statButton('Undo last stat')).toBeInTheDocument();
    expect(lastAction()).toHaveTextContent('Tap a button to record a stat');
    // Full screen: no tab bar to tap by mistake.
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
  });

  it('titles an away game with @', async () => {
    const game = await newGame({ homeAway: 'away' });
    await renderTracking(game);
    expect(screen.getByRole('heading', { level: 1, name: '@ Central' })).toBeInTheDocument();
  });

  it('records a tap right away and updates the strip, the counts and the last-action line', async () => {
    const game = await newGame();
    await renderTracking(game);

    fireEvent.click(statButton('3PT Made'));
    // Confirmed on the spot, before the database has answered, in the fixed line: never
    // in a floating toast, which would cover the bottom row of stat buttons.
    expect(lastAction()).toHaveTextContent('3PT Made · Q1');
    expect(notifications()).toBeEmptyDOMElement();
    await expectStrip('Points: 3', '3-pointers: 1 of 1', 'Field goals: 1 of 1');
    await waitFor(() => expect(statButton('3PT Made')).toHaveAccessibleDescription('1 this game'));
    expect(statButton('2PT Made')).not.toHaveAccessibleDescription();

    fireEvent.click(statButton('2PT Made'));
    fireEvent.click(statButton('2PT Made'));
    fireEvent.click(statButton('FT Miss'));
    fireEvent.click(statButton('Off Reb'));
    fireEvent.click(statButton('Def Reb'));
    await expectStrip('Points: 7', 'Field goals: 3 of 3', 'Free throws: 0 of 1', 'Rebounds: 2');
    await waitFor(() => expect(statButton('2PT Made')).toHaveAccessibleDescription('2 this game'));
    expect(lastAction()).toHaveTextContent('Def Reb · Q1');
    expect(await eventTypes(game.id)).toEqual([
      'fg3_made',
      'fg2_made',
      'fg2_made',
      'ft_miss',
      'oreb',
      'dreb',
    ]);
  });

  it('records every one of many quick taps, in order', async () => {
    const game = await newGame();
    await renderTracking(game);
    const taps = [
      '2PT Made',
      'Assist',
      '2PT Made',
      'Steal',
      '3PT Miss',
      'Def Reb',
      'FT Made',
      'FT Made',
      'Block',
      'Turnover',
      'Foul',
      'Deflection',
      'Charge Taken',
      '2PT Miss',
    ];

    // No awaiting between taps: none may be dropped, debounced or reordered.
    for (const name of taps) fireEvent.click(statButton(name));

    await waitFor(async () => expect(await getGameEvents(game.id)).toHaveLength(taps.length));
    expect(await eventTypes(game.id)).toEqual([
      'fg2_made',
      'ast',
      'fg2_made',
      'stl',
      'fg3_miss',
      'dreb',
      'ft_made',
      'ft_made',
      'blk',
      'tov',
      'foul',
      'deflection',
      'charge',
      'fg2_miss',
    ]);
    await expectStrip('Points: 6', 'Field goals: 2 of 4', 'Free throws: 2 of 2', 'Fouls: 1');
  });

  it("the line's Undo removes exactly the stat it belongs to, and only once", async () => {
    const game = await newGame();
    await renderTracking(game);

    fireEvent.click(statButton('Steal'));
    fireEvent.click(statButton('Assist'));
    const undo = within(lastAction()).getByRole('button', { name: 'Undo' });
    // A double tap: the second one must not remove the Steal too.
    fireEvent.click(undo);
    fireEvent.click(undo);

    expect(lastAction()).toHaveTextContent('Removed Assist');
    expect(within(lastAction()).queryByRole('button')).not.toBeInTheDocument();
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
    await expectStrip('Assists: 0', 'Steals: 1');
  });

  it("the grid's Undo removes the latest stat, or says there's nothing to undo", async () => {
    const game = await newGame();
    await renderTracking(game);

    fireEvent.click(statButton('Undo last stat'));
    await waitFor(() => expect(lastAction()).toHaveTextContent('Nothing to undo'));

    fireEvent.click(statButton('Block'));
    fireEvent.click(statButton('Foul'));
    fireEvent.click(statButton('Undo last stat'));
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Foul'));
    expect(await eventTypes(game.id)).toEqual(['blk']);
    await expectStrip('Blocks: 1', 'Fouls: 0');
  });

  it('after a relaunch, the line offers to undo the latest saved stat', async () => {
    const game = await newGame();
    await recordStat(game.id, 'fg2_made');
    await setCurrentPeriod(game.id, 2);
    await recordStat(game.id, 'ft_made');
    await renderTracking(game);

    await waitFor(() => expect(lastAction()).toHaveTextContent('FT Made · Q2'));
    await expectStrip('Points: 3');
    fireEvent.click(within(lastAction()).getByRole('button', { name: 'Undo' }));
    expect(lastAction()).toHaveTextContent('Removed FT Made');
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['fg2_made']));
  });

  it('moves to the next period (with an Undo), and records new stats there', async () => {
    const game = await newGame();
    await renderTracking(game);

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(lastAction()).toHaveTextContent('Now in Q2');
    await screen.findByRole('button', { name: 'Period Q2' });
    expect((await getGame(game.id))?.currentPeriod).toBe(2);

    fireEvent.click(statButton('2PT Made'));
    expect(lastAction()).toHaveTextContent('2PT Made · Q2');
    await waitFor(async () => expect((await getGameEvents(game.id))[0]?.period).toBe(2));

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await screen.findByRole('button', { name: 'Period Q3' });
    const undo = within(lastAction()).getByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(lastAction()).toHaveTextContent('Back in Q2');
    await screen.findByRole('button', { name: 'Period Q2' });
    expect((await getGame(game.id))?.currentPeriod).toBe(2);
  });

  it('picks any period, overtime included, from the period sheet', async () => {
    const game = await newGame();
    const { user } = await renderTracking(game);

    await user.click(screen.getByRole('button', { name: 'Period Q1' }));
    const sheet = screen.getByRole('dialog', { name: 'Period' });
    const periods = within(sheet).getAllByRole('button', { name: /^(Q\d|\d*OT)$/ });
    expect(periods.map((button) => button.textContent)).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'OT',
      '2OT',
      '3OT',
      '4OT',
    ]);
    expect(within(sheet).getByRole('button', { name: 'Q1' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await user.click(within(sheet).getByRole('button', { name: 'OT' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByRole('button', { name: 'Period OT' });
    expect(lastAction()).toHaveTextContent('Now in OT');
    expect((await getGame(game.id))?.currentPeriod).toBe(5);
  });

  it('labels halves, and stops Next at the last possible period', async () => {
    const game = await newGame({ periodFormat: 'halves' });
    await setCurrentPeriod(game.id, MAX_PERIOD);
    await renderTracking(game);

    expect(screen.getByRole('button', { name: 'Period 18OT' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
  });

  it('lists the log newest first and deletes a stat once confirmed', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 27, 19, 42, 5) });
    const game = await newGame();
    await recordStat(game.id, 'fg2_made');
    await setCurrentPeriod(game.id, 2);
    await recordStat(game.id, 'stl');
    await recordStat(game.id, 'fg3_miss');
    const { user } = await renderTracking(game);

    await user.click(screen.getByRole('button', { name: 'Log' }));
    const sheet = screen.getByRole('dialog', { name: 'Stat log' });
    const rows = () =>
      within(within(sheet).getByRole('list', { name: 'Stats, newest first' }))
        .getAllByRole('listitem')
        .map((row) => row.textContent);
    expect(rows()).toEqual(['3PT MissQ27:42:05', 'StealQ27:42:05', '2PT MadeQ17:42:05']);

    // Cancelling keeps it.
    await user.click(within(sheet).getByRole('button', { name: /^Steal/ }));
    const keep = screen.getByRole('alertdialog', { name: 'Delete Steal (Q2)?' });
    await user.click(within(keep).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await eventTypes(game.id)).toEqual(['fg2_made', 'stl', 'fg3_miss']);

    await user.click(within(sheet).getByRole('button', { name: /^2PT Made/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete 2PT Made (Q1)?' });
    expect(confirm).toHaveAccessibleDescription('Recorded at 7:42:05.');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl', 'fg3_miss']));
    await waitFor(() => expect(rows()).toEqual(['3PT MissQ27:42:05', 'StealQ27:42:05']));
    expect(notifications()).toHaveTextContent('Deleted 2PT Made (Q1)');
    expect(lastAction()).toHaveTextContent('Deleted 2PT Made (Q1)');
  });

  it('says so when the log is empty', async () => {
    const game = await newGame();
    const { user } = await renderTracking(game);
    await user.click(screen.getByRole('button', { name: 'Log' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Stat log' })).getByText(
        'No stats yet. Tap a button to record one.',
      ),
    ).toBeInTheDocument();
  });

  it('ends the game with the final score and replaces this screen with the report', async () => {
    const game = await newGame();
    const { user, router } = await renderTracking(game);

    await user.click(screen.getByRole('button', { name: 'End game' }));
    const sheet = screen.getByRole('dialog', { name: 'Final score' });
    const ours = within(sheet).getByRole('textbox', { name: 'Our team' });
    expect(ours).toHaveAttribute('inputmode', 'numeric');
    expect(ours).toHaveAttribute('pattern', '[0-9]*');
    await user.type(ours, '46');
    await user.type(within(sheet).getByRole('textbox', { name: 'Opponent' }), '39');
    await user.click(within(sheet).getByRole('button', { name: 'End game' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await getGame(game.id)).toMatchObject({
      status: 'final',
      teamScore: 46,
      opponentScore: 39,
    });
  });

  it('leaves a blank score out, and refuses one that is not a number', async () => {
    const game = await newGame();
    const { user, router } = await renderTracking(game);

    await user.click(screen.getByRole('button', { name: 'End game' }));
    const sheet = screen.getByRole('dialog', { name: 'Final score' });
    const opponent = within(sheet).getByRole('textbox', { name: 'Opponent' });
    await user.type(opponent, '4a');
    await user.click(within(sheet).getByRole('button', { name: 'End game' }));
    expect(opponent).toHaveAccessibleDescription('Use numbers only (0–999)');
    expect((await getGame(game.id))?.status).toBe('live');

    await user.clear(opponent);
    await user.click(within(sheet).getByRole('button', { name: 'End game' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
    const ended = await getGame(game.id);
    expect(ended?.status).toBe('final');
    expect(ended).not.toHaveProperty('teamScore');
    expect(ended).not.toHaveProperty('opponentScore');
  });

  it('keeps tracking when asked, with the game still live', async () => {
    const game = await newGame();
    const { user } = await renderTracking(game);

    await user.click(screen.getByRole('button', { name: 'End game' }));
    const sheet = screen.getByRole('dialog', { name: 'Final score' });
    // Only its own buttons close it: Escape doesn't lose what was typed.
    await user.type(within(sheet).getByRole('textbox', { name: 'Our team' }), '12');
    await user.keyboard('{Escape}');
    expect(sheet).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Keep tracking' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect((await getGame(game.id))?.status).toBe('live');
  });

  it('edits a finished game: a banner, Done instead of End game, and stats still record', async () => {
    const game = await newGame();
    await endGame(game.id, { teamScore: 40, opponentScore: 31 });
    const { user, router } = await renderTracking(game);

    expect(screen.getByText('Editing a finished game')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End game' })).not.toBeInTheDocument();

    fireEvent.click(statButton('3PT Made'));
    await expectStrip('Points: 3');
    expect(await getGame(game.id)).toMatchObject({ status: 'final', teamScore: 40 });

    await user.click(screen.getByRole('link', { name: 'Done' }));
    expect(router.state.location.pathname).toBe(paths.gameReport(game.id));
    expect(router.state.historyAction).toBe('REPLACE');
    expect((await getGame(game.id))?.status).toBe('final');
  });

  it('warns about foul trouble at 4 fouls and shows fouled out at 5', async () => {
    const game = await newGame();
    await renderTracking(game);

    for (let i = 0; i < 4; i++) fireEvent.click(statButton('Foul'));
    await expectStrip('Fouls: 4 (foul trouble)');
    fireEvent.click(statButton('Foul'));
    await expectStrip('Fouls: 5 (fouled out)');
  });

  it('says when a stat could not be saved, and saves it on Retry', async () => {
    const game = await newGame();
    await renderTracking(game);
    vi.spyOn(repo, 'recordStat').mockRejectedValueOnce(new Error('Disk full'));

    fireEvent.click(statButton('Steal'));
    await waitFor(() => expect(lastAction()).toHaveTextContent("Couldn't save Steal"));
    expect(await eventTypes(game.id)).toEqual([]);

    fireEvent.click(within(lastAction()).getByRole('button', { name: 'Retry' }));
    expect(lastAction()).toHaveTextContent('Steal · Q1');
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
  });

  it('goes back to Games without ending the game', async () => {
    const game = await newGame();
    const { user, router } = await renderTracking(game);
    await user.click(screen.getByRole('link', { name: 'Games' }));
    expect(router.state.location.pathname).toBe(paths.home);
    expect((await getGame(game.id))?.status).toBe('live');
  });

  it('shows a friendly message for a game that does not exist', async () => {
    const { user, router } = renderRoute(paths.trackGame('no-such-game'));

    expect(await screen.findByRole('heading', { name: 'Game not found' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Live game' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Record a stat' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Games' }));
    expect(router.state.location.pathname).toBe(paths.home);
  });

  it('shows nothing while the game loads, rather than a layout that would jump', () => {
    renderRoute(paths.trackGame('loading'));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Record a stat' })).not.toBeInTheDocument();
  });
});
