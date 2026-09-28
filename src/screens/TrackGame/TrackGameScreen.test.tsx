import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/data/db';
import { replayPendingStats, startPendingStatsRetry } from '@/data/pendingSaves';
import { listPendingStats } from '@/data/pendingStats';
import * as repo from '@/data/repo';
import {
  createGame,
  deleteStat,
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
import { AUTO_RETRY_MS } from './session';
import { DOUBLE_TAP_MS } from './tracking';

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
/** The last-action line's button ("Undo"); the grid's is "Undo last stat". */
const lineButton = (name = 'Undo') => screen.getByRole('button', { name });
const notSaved = () => screen.queryByRole('alert');

/** Taps the line's button once it takes taps (it ignores them just after it changes). */
async function tapLineButton(name = 'Undo') {
  const button = lineButton(name);
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

/** Waits out the double-tap window, so the next tap on the same control counts. */
const afterDoubleTapWindow = () =>
  new Promise((resolve) => setTimeout(resolve, DOUBLE_TAP_MS + 50));

/** Waits until the stat strip says `text` (what a screen reader hears), e.g. 'Points: 5'. */
async function expectStrip(...texts: string[]) {
  await waitFor(() => {
    for (const text of texts) expect(within(strip()).getByText(text)).toBeInTheDocument();
  });
}

async function eventTypes(gameId: string): Promise<StatType[]> {
  return (await getGameEvents(gameId)).map((event) => event.type);
}

async function eventPeriods(gameId: string): Promise<[StatType, number][]> {
  return (await getGameEvents(gameId)).map((event) => [event.type, event.period]);
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
    const buttons = within(grid()).getAllByRole('button');
    // Full names for VoiceOver and Voice Control...
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
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
      'Undo last stat',
    ]);
    // ...and at most two short words on each button, which still read as that name.
    expect(buttons.map((button) => button.textContent)).toEqual([
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
      'Turn-over',
      'Foul',
      'Deflect',
      'Charge Taken',
      'Undo',
    ]);
    expect(lastAction()).toHaveTextContent('Tap a button to record a stat');
    expect(notSaved()).not.toBeInTheDocument();
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
    // Only the message is read out, not the Undo button next to it.
    expect(within(lastAction()).queryByRole('button')).not.toBeInTheDocument();
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

  // (That each line action runs at most once is tested in LastActionLine.test.tsx, and
  // that taking back a tap twice removes it once, in session.test.ts.)
  it("the line's Undo removes exactly the stat it belongs to, even on a double tap", async () => {
    const game = await newGame();
    await renderTracking(game);

    fireEvent.click(statButton('Steal'));
    fireEvent.click(statButton('Assist'));
    const undo = lineButton();
    // Right after a stat, a quick "wrong stat, Undo" counts...
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    // ...and the second tap of a double tap does nothing more.
    fireEvent.click(undo);

    expect(lastAction()).toHaveTextContent('Removed Assist');
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
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
    await afterDoubleTapWindow();
    fireEvent.click(statButton('Undo last stat'));
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Foul'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['blk']));
    await expectStrip('Blocks: 1', 'Fouls: 0');
  });

  it("a double tap on the grid's Undo removes one stat", async () => {
    const game = await newGame();
    for (const type of ['stl', 'ast', 'blk'] as const) await recordStat(game.id, type);
    await renderTracking(game);

    fireEvent.click(statButton('Undo last stat'));
    fireEvent.click(statButton('Undo last stat'));
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Block'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl', 'ast']));

    // A deliberate second Undo, a moment later, takes the next one.
    await afterDoubleTapWindow();
    fireEvent.click(statButton('Undo last stat'));
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Assist'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
  });

  it('after a relaunch, the line offers to undo the latest saved stat', async () => {
    const game = await newGame();
    await recordStat(game.id, 'fg2_made');
    await setCurrentPeriod(game.id, 2);
    await recordStat(game.id, 'ft_made');
    await renderTracking(game);

    await waitFor(() => expect(lastAction()).toHaveTextContent('FT Made · Q2'));
    await expectStrip('Points: 3');
    await tapLineButton();
    // Said once it's done: a saved stat only counts as removed once it's gone.
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed FT Made'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['fg2_made']));
  });

  it("the line's Undo ignores taps for a moment after the grid's Undo, just above it", async () => {
    const game = await newGame();
    for (const type of ['stl', 'blk'] as const) await recordStat(game.id, type);
    await renderTracking(game);
    await waitFor(() => expect(lastAction()).toHaveTextContent('Block · Q1'));
    const lineUndo = lineButton();
    expect(lineUndo).toBeEnabled();

    // A double tap on the grid's Undo whose second tap lands on the line's Undo.
    fireEvent.click(statButton('Undo last stat'));
    expect(lineUndo).toBeDisabled();
    fireEvent.click(lineUndo);
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Block'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
    await afterDoubleTapWindow();
    expect(await eventTypes(game.id)).toEqual(['stl']);
  });

  it('after coming back to a finished game, Undo goes by the stats still there', async () => {
    const game = await newGame();
    const { user, router } = await renderTracking(game);
    fireEvent.click(statButton('Steal'));
    fireEvent.click(statButton('Block'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl', 'blk']));

    // End game; on the report, delete the Block from the play-by-play.
    await user.click(screen.getByRole('button', { name: 'End game' }));
    const sheet = screen.getByRole('dialog', { name: 'Final score' });
    await user.click(within(sheet).getByRole('button', { name: 'End game' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
    const plays = await screen.findByRole('list', { name: '1st quarter plays' });
    await user.click(within(plays).getByRole('button', { name: /Block/ }));
    const confirm = screen.getByRole('alertdialog', { name: 'Delete this stat?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete stat' }));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));

    // "Add or fix stats", then the grid's Undo: the Steal goes, not the Block again.
    await user.click(screen.getByRole('link', { name: 'Add or fix stats' }));
    await screen.findByRole('group', { name: 'Record a stat' });
    fireEvent.click(statButton('Undo last stat'));
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Steal'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual([]));
  });

  it('Undo skips a stat deleted in another tab, and never says it removed it', async () => {
    const game = await newGame();
    for (const type of ['stl', 'blk'] as const) await recordStat(game.id, type);
    await renderTracking(game);
    await waitFor(() => expect(lastAction()).toHaveTextContent('Block · Q1'));

    const block = (await getGameEvents(game.id)).at(-1);
    await deleteStat(block?.id ?? '');
    // Straight away, before this screen has read the change.
    fireEvent.click(statButton('Undo last stat'));
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Steal'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual([]));
  });

  it("copes with a stat this version doesn't know (e.g. from a newer app)", async () => {
    const game = await newGame();
    await recordStat(game.id, 'ast');
    await db.events.add({
      id: 'from-the-future',
      gameId: game.id,
      type: 'dunk' as StatType,
      period: 1,
      createdAt: Date.now() + 1000,
    });
    await renderTracking(game);

    expect(lastAction()).toHaveTextContent('dunk · Q1');
    await expectStrip('Assists: 1');
    fireEvent.click(screen.getByRole('button', { name: 'Log' }));
    const log = await screen.findByRole('dialog', { name: 'Stat log' });
    expect(within(log).getAllByRole('listitem')[0]).toHaveTextContent('dunk');
  });

  it('moves to the next period (with an Undo), and records new stats there', async () => {
    const game = await newGame();
    await renderTracking(game);

    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(lastAction()).toHaveTextContent('Now in Q2');
    expect(screen.getByRole('button', { name: 'Period Q2' })).toBeInTheDocument();
    await waitFor(async () => expect((await getGame(game.id))?.currentPeriod).toBe(2));

    fireEvent.click(statButton('2PT Made'));
    expect(lastAction()).toHaveTextContent('2PT Made · Q2');
    await waitFor(async () => expect(await eventPeriods(game.id)).toEqual([['fg2_made', 2]]));

    await afterDoubleTapWindow();
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(screen.getByRole('button', { name: 'Period Q3' })).toBeInTheDocument();
    await tapLineButton();
    expect(lastAction()).toHaveTextContent('Back in Q2');
    expect(screen.getByRole('button', { name: 'Period Q2' })).toBeInTheDocument();
    await waitFor(async () => expect((await getGame(game.id))?.currentPeriod).toBe(2));
  });

  it('a double tap on Next moves one period', async () => {
    const game = await newGame();
    await setCurrentPeriod(game.id, 3);
    await renderTracking(game);

    const next = screen.getByRole('button', { name: 'Next period' });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByRole('button', { name: 'Period Q4' })).toBeInTheDocument();
    await waitFor(async () => expect((await getGame(game.id))?.currentPeriod).toBe(4));
    await afterDoubleTapWindow();
    expect((await getGame(game.id))?.currentPeriod).toBe(4);
    expect(screen.getByRole('button', { name: 'Period Q4' })).toBeInTheDocument();
  });

  it('a stat tapped right after Next lands in the period on screen', async () => {
    const game = await newGame();
    await setCurrentPeriod(game.id, 3);
    await renderTracking(game);

    // In the same moment: before the new period is saved or shown by the database.
    fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
    fireEvent.click(statButton('Steal'));
    expect(lastAction()).toHaveTextContent('Steal · Q4');
    await waitFor(async () => expect(await eventPeriods(game.id)).toEqual([['stl', 4]]));
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
    await waitFor(async () => expect((await getGame(game.id))?.currentPeriod).toBe(5));
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
    // Said on the line (under the log), not in a toast that would outstay the log.
    await waitFor(() => expect(lastAction()).toHaveTextContent('Deleted 2PT Made (Q1)'));
    expect(notifications()).toBeEmptyDOMElement();
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
    // Return ("next") after the first score moves on to the second, not ending the game.
    await user.type(ours, '46{Enter}');
    const theirs = within(sheet).getByRole('textbox', { name: 'Opponent' });
    expect(theirs).toHaveFocus();
    expect((await getGame(game.id))?.status).toBe('live');
    await user.type(theirs, '39');
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

  it('clears a saved score when its field is emptied', async () => {
    const game = await newGame();
    await repo.updateGame(game.id, { teamScore: 40, opponentScore: 31 });
    const { user, router } = await renderTracking(game);

    await user.click(screen.getByRole('button', { name: 'End game' }));
    const sheet = screen.getByRole('dialog', { name: 'Final score' });
    const ours = within(sheet).getByRole('textbox', { name: 'Our team' });
    expect(ours).toHaveValue('40');
    await user.clear(ours);
    await user.click(within(sheet).getByRole('button', { name: 'End game' }));

    await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
    const ended = await getGame(game.id);
    expect(ended).not.toHaveProperty('teamScore');
    expect(ended).toMatchObject({ status: 'final', opponentScore: 31 });
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

  it('waits for stats being saved before ending, and keeps tracking if asked meanwhile', async () => {
    const game = await newGame();
    const { user, router } = await renderTracking(game);
    // A slow save: it lands only when the test says so.
    let land = () => {};
    const { recordStat: save } = repo;
    vi.spyOn(repo, 'recordStat').mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          land = () => resolve(save(...args));
        }),
    );
    fireEvent.click(statButton('Steal'));

    await user.click(screen.getByRole('button', { name: 'End game' }));
    const sheet = screen.getByRole('dialog', { name: 'Final score' });
    const end = within(sheet).getByRole('button', { name: 'End game' });
    await user.click(end);
    expect(end).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Keep tracking' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    act(() => land());
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
    await afterDoubleTapWindow();
    expect((await getGame(game.id))?.status).toBe('live');
    expect(router.state.location.pathname).toBe(paths.trackGame(game.id));
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

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
    expect(router.state.historyAction).toBe('REPLACE');
    expect((await getGame(game.id))?.status).toBe('final');
    expect(await eventTypes(game.id)).toEqual(['fg3_made']);
  });

  it('warns about foul trouble at 4 fouls, on the line too, and shows fouled out at 5', async () => {
    const game = await newGame();
    for (let i = 0; i < 3; i++) await recordStat(game.id, 'foul');
    await renderTracking(game);
    await expectStrip('Fouls: 3');

    // Two quick fouls, the second before anything is saved: each says its own count.
    fireEvent.click(statButton('Foul'));
    expect(lastAction()).toHaveTextContent('Foul · Q1 · 4 fouls');
    expect(lastAction()).not.toHaveTextContent('fouled out');
    fireEvent.click(statButton('Foul'));
    expect(lastAction()).toHaveTextContent('Foul · Q1 · 5 fouls, fouled out');
    expect(statButton('Foul')).toHaveAccessibleDescription('5 this game');
    await expectStrip('Fouls: 5 (fouled out)');
    await waitFor(async () => expect(await eventTypes(game.id)).toHaveLength(5));
  });

  describe('when a stat could not be saved', () => {
    it('keeps it on screen through later taps until Retry saves it, in its own period', async () => {
      const game = await newGame();
      await renderTracking(game);
      // Steals can't be saved (not at the tap, nor by the retries the next tap and the
      // timer make) until Retry is tapped; other stats save fine.
      let stealsFail = true;
      const { recordStat: save } = repo;
      const spy = vi
        .spyOn(repo, 'recordStat')
        .mockImplementation((...args) =>
          stealsFail && args[1] === 'stl' ? Promise.reject(new Error('Disk full')) : save(...args),
        );

      fireEvent.click(statButton('Steal'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Steal not saved');
      expect(notSaved()).toHaveTextContent(
        "It's kept on this phone and will be saved automatically.",
      );
      expect(lastAction()).toHaveTextContent('Steal not saved');
      // It still counts.
      await expectStrip('Steals: 1');

      // Another tap, in another period, doesn't clear it.
      fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
      fireEvent.click(statButton('Assist'));
      expect(lastAction()).toHaveTextContent('Assist · Q2');
      await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['ast']));
      expect(notSaved()).toHaveTextContent('Steal not saved');

      // Retry's tap is what saves it: the save starts right then, and lands.
      const retry = screen.getByRole('button', { name: 'Retry' });
      await waitFor(() => expect(retry).toBeEnabled());
      const saves = spy.mock.calls.length;
      stealsFail = false;
      fireEvent.click(retry);
      expect(spy.mock.calls.length).toBe(saves + 1);
      await waitFor(() => expect(notSaved()).not.toBeInTheDocument());
      // In tap order, in the period it was tapped in.
      expect(await eventPeriods(game.id)).toEqual([
        ['stl', 1],
        ['ast', 2],
      ]);
      await expectStrip('Steals: 1', 'Assists: 1');
      expect(listPendingStats()).toEqual([]);
    });

    it('saves it on its own a moment later', async () => {
      const game = await newGame();
      await renderTracking(game);
      vi.spyOn(repo, 'recordStat').mockRejectedValueOnce(new Error('Database closed'));

      fireEvent.click(statButton('Block'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Block not saved');
      await waitFor(() => expect(notSaved()).not.toBeInTheDocument(), {
        timeout: AUTO_RETRY_MS + 2000,
      });
      expect(await eventTypes(game.id)).toEqual(['blk']);
      expect(lastAction()).toHaveTextContent('Block · Q1');
    });

    it('never saves it once it was undone, even if the save fails after the Undo', async () => {
      const game = await newGame();
      await renderTracking(game);
      let fail: (error: Error) => void = () => {};
      vi.spyOn(repo, 'recordStat').mockReturnValueOnce(
        new Promise((_, reject) => {
          fail = reject;
        }),
      );

      fireEvent.click(statButton('Steal'));
      await tapLineButton();
      expect(lastAction()).toHaveTextContent('Removed Steal');
      act(() => fail(new Error('Disk full')));
      await new Promise((resolve) => setTimeout(resolve, AUTO_RETRY_MS + 200));
      // No retry offer replaced "Removed Steal", and nothing was saved or kept.
      expect(lastAction()).toHaveTextContent('Removed Steal');
      expect(notSaved()).not.toBeInTheDocument();
      expect(await eventTypes(game.id)).toEqual([]);
      expect(listPendingStats()).toEqual([]);
    });

    it('End game says so instead of ending; End anyway leaves it to be saved later', async () => {
      const game = await newGame();
      const { user, router } = await renderTracking(game);
      const spy = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Connection lost'));
      fireEvent.click(statButton('Steal'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Steal not saved');

      await user.click(screen.getByRole('button', { name: 'End game' }));
      const sheet = screen.getByRole('dialog', { name: 'Final score' });
      await user.type(within(sheet).getByRole('textbox', { name: 'Our team' }), '41');
      await user.click(within(sheet).getByRole('button', { name: 'End game' }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(
        "1 stat isn't saved yet. It's kept on this phone and will be saved automatically.",
      );
      expect(router.state.location.pathname).toBe(paths.trackGame(game.id));
      expect((await getGame(game.id))?.status).toBe('live');
      // The score typed so far stays.
      expect(within(sheet).getByRole('textbox', { name: 'Our team' })).toHaveValue('41');

      // Trying again still fails: still said, still not ended.
      const tryAgain = within(sheet).getByRole('button', { name: 'Try again' });
      const saves = spy.mock.calls.length;
      await user.click(tryAgain);
      await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(saves));
      await waitFor(() => expect(tryAgain).toBeEnabled());
      expect(within(sheet).getByRole('alert')).toHaveTextContent("1 stat isn't saved yet.");
      expect((await getGame(game.id))?.status).toBe('live');

      await user.click(within(sheet).getByRole('button', { name: 'End anyway' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
      expect(await getGame(game.id)).toMatchObject({ status: 'final', teamScore: 41 });
      expect(await eventTypes(game.id)).toEqual([]);

      // The next start of the app saves it: once.
      spy.mockRestore();
      expect(await replayPendingStats()).toEqual({ saved: 1, dropped: 0, failed: 0 });
      expect(await replayPendingStats()).toEqual({ saved: 0, dropped: 0, failed: 0 });
      expect(await eventTypes(game.id)).toEqual(['stl']);
    });

    it('Done waits for it to be saved, and says so if it still is not', async () => {
      const game = await newGame();
      await endGame(game.id, { teamScore: 40, opponentScore: 31 });
      const { user, router } = await renderTracking(game);
      const spy = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Connection lost'));
      fireEvent.click(statButton('Block'));
      fireEvent.click(statButton('Steal'));
      await waitFor(() => expect(notSaved()).toHaveTextContent('2 stats not saved'));
      expect(notSaved()).toHaveTextContent(
        "They're kept on this phone and will be saved automatically.",
      );

      await user.click(screen.getByRole('button', { name: 'Done' }));
      const sheet = await screen.findByRole('dialog', { name: "2 stats aren't saved yet" });
      expect(sheet).toHaveAccessibleDescription(
        "They're kept on this phone and will be saved automatically.",
      );
      expect(router.state.location.pathname).toBe(paths.trackGame(game.id));

      // Saving works again: Try again saves both, then leaves.
      spy.mockRestore();
      await user.click(within(sheet).getByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
      expect(router.state.historyAction).toBe('REPLACE');
      expect(await eventTypes(game.id)).toEqual(['blk', 'stl']);
      expect(listPendingStats()).toEqual([]);
    });

    it('Done anyway leaves it kept on the phone', async () => {
      const game = await newGame();
      await endGame(game.id);
      const { user, router } = await renderTracking(game);
      vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Connection lost'));
      fireEvent.click(statButton('Assist'));
      await screen.findByRole('alert');

      await user.click(screen.getByRole('button', { name: 'Done' }));
      const sheet = await screen.findByRole('dialog', { name: "1 stat isn't saved yet" });
      await user.click(within(sheet).getByRole('button', { name: 'Done anyway' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
      expect(listPendingStats().map((stat) => [stat.gameId, stat.type])).toEqual([
        [game.id, 'ast'],
      ]);
    });

    it("says when it isn't kept on the phone either", async () => {
      const game = await newGame();
      await renderTracking(game);
      vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Connection lost'));
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });
      fireEvent.click(statButton('Steal'));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "It's not kept on this phone. Keep the app open until it's saved.",
      );
    });

    describe('once the screen has closed', () => {
      // The app-wide retry, as main.tsx starts it, with short waits.
      let stopRetry = () => {};
      beforeEach(() => {
        stopRetry = startPendingStatsRetry({ delaysMs: [100] });
      });
      afterEach(() => {
        stopRetry();
      });

      /** Ends the game with its sheet, saying "End anyway" to the stat not saved. */
      async function endAnyway(user: ReturnType<typeof renderRoute>['user'], notice: string) {
        await user.click(screen.getByRole('button', { name: 'End game' }));
        const sheet = screen.getByRole('dialog', { name: 'Final score' });
        await user.click(within(sheet).getByRole('button', { name: 'End game' }));
        expect(await within(sheet).findByRole('alert')).toHaveTextContent(notice);
        await user.click(within(sheet).getByRole('button', { name: 'End anyway' }));
      }

      /** Waits until the report (on screen) lists the Q1 play `name`. */
      async function expectOnReport(name: RegExp) {
        const plays = await screen.findByRole(
          'list',
          { name: '1st quarter plays' },
          { timeout: 3000 },
        );
        expect(within(plays).getByRole('button', { name })).toBeInTheDocument();
      }

      it('End anyway: it is saved once the database works again, with no tracker or restart', async () => {
        const game = await newGame();
        const { user, router } = await renderTracking(game);
        const failing = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Lost'));
        fireEvent.click(statButton('Steal'));
        await screen.findByRole('alert');
        // The retries fail too, for a while.
        await waitFor(() => expect(failing.mock.calls.length).toBeGreaterThanOrEqual(3));
        await endAnyway(
          user,
          "1 stat isn't saved yet. It's kept on this phone and will be saved automatically.",
        );
        await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
        expect(await eventTypes(game.id)).toEqual([]);

        // IndexedDB works again: the report gets the stat on its own.
        failing.mockRestore();
        await expectOnReport(/Steal/);
        expect(await eventTypes(game.id)).toEqual(['stl']);
        expect(listPendingStats()).toEqual([]);
      });

      it('not kept on the phone: keeping the app open saves it, as the screen says', async () => {
        const game = await newGame();
        const { user, router } = await renderTracking(game);
        const failing = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Lost'));
        const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        });
        fireEvent.click(statButton('Block'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
          "It's not kept on this phone. Keep the app open until it's saved.",
        );
        await endAnyway(
          user,
          "1 stat isn't saved yet. It's not kept on this phone. Keep the app open until it's saved.",
        );
        await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
        expect(listPendingStats()).toEqual([]);

        failing.mockRestore();
        full.mockRestore();
        await expectOnReport(/Block/);
        expect(await eventTypes(game.id)).toEqual(['blk']);
      });

      it('Games: it is saved on its own later, whatever screen is showing', async () => {
        const game = await newGame();
        const { user, router } = await renderTracking(game);
        const failing = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Lost'));
        fireEvent.click(statButton('Assist'));
        await screen.findByRole('alert');
        await user.click(screen.getByRole('link', { name: 'Games' }));
        expect(router.state.location.pathname).toBe(paths.home);

        failing.mockRestore();
        await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['ast']), {
          timeout: 3000,
        });
        expect(router.state.location.pathname).toBe(paths.home);
      });
    });
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
