import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courtToSvg, courtViewBox } from '@/components/Court/courtGeometry';
import { courtBox, mockScreenBox, svgToClient } from '@/components/Court/courtTestUtils';
import { db } from '@/data/db';
import { demoGameId, seedDemoData } from '@/data/demo';
import { READ_RETRY_DELAYS_MS, READ_WATCHDOG_MS } from '@/data/hooks';
import { listPendingRemovals } from '@/data/pendingRemovals';
import { replayPendingStats, retryPendingStats, startPendingStatsRetry } from '@/data/pendingSaves';
import { listPendingSpots } from '@/data/pendingSpots';
import { addPendingStat, listPendingStats, newPendingStat } from '@/data/pendingStats';
import { setReopenDelaysForTests } from '@/data/reopen';
import * as repo from '@/data/repo';
import {
  createGame,
  deleteStat,
  endGame,
  getGame,
  getGameEvents,
  recordStat,
  setCurrentPeriod,
  updateSettings,
  type NewGame,
} from '@/data/repo';
import { clearAllData } from '@/data/transfer';
import { MAX_PERIOD, type CourtPoint, type Game, type StatType } from '@/data/types';
import { paths } from '@/routes';
import { renderRoute } from '@/test/render';
import { AUTO_RETRY_MS, disposeTrackingSessions } from './session';
import { COURT_DEPTH } from './ShotCourt';
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

  it('stops counting a stat the moment Undo takes it back, while its removal lands', async () => {
    const game = await newGame();
    for (const type of ['stl', 'stl'] as const) await recordStat(game.id, type);
    await renderTracking(game);
    await expectStrip('Steals: 2');
    // A slow removal: it lands only when the test says so.
    let land = () => {};
    const { deleteStat: remove } = repo;
    vi.spyOn(repo, 'deleteStat').mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          land = () => resolve(remove(...args));
        }),
    );

    fireEvent.click(statButton('Undo last stat'));
    await expectStrip('Steals: 1');
    expect(statButton('Steal')).toHaveAccessibleDescription('1 this game');
    act(() => land());
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Steal'));
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
    await expectStrip('Steals: 1');
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

  it('after a relaunch, counts and saves a tap the earlier page kept, without calling it not saved', async () => {
    const game = await newGame();
    addPendingStat(newPendingStat({ gameId: game.id, type: 'stl', period: 1 }));
    const alerts: string[] = [];
    const watch = new MutationObserver(() => {
      for (const alert of screen.queryAllByRole('alert')) alerts.push(alert.textContent);
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await renderTracking(game);
      await expectStrip('Steals: 1');
      await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
      await expectStrip('Steals: 1');
      // Never painted (or announced) as "not saved": no save of it had failed.
      expect(alerts).toEqual([]);
      expect(lastAction()).toHaveTextContent('Steal · Q1');
    } finally {
      watch.disconnect();
    }
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

  /** Makes the next save wait until the returned function is called. */
  function slowNextSave() {
    let land = () => {};
    const { recordStat: save } = repo;
    vi.spyOn(repo, 'recordStat').mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          land = () => resolve(save(...args));
        }),
    );
    return () => act(() => land());
  }

  it('never ends the game for an End game taken back, even with End game open again', async () => {
    const game = await newGame();
    const { user, router } = await renderTracking(game);
    const land = slowNextSave();
    fireEvent.click(statButton('Steal'));

    await user.click(screen.getByRole('button', { name: 'End game' }));
    let sheet = screen.getByRole('dialog', { name: 'Final score' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Our team' }), '40');
    await user.click(within(sheet).getByRole('button', { name: 'End game' }));
    await user.click(within(sheet).getByRole('button', { name: 'Keep tracking' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Opened again (to fix the score), and typed into, while the first one still waits.
    await user.click(screen.getByRole('button', { name: 'End game' }));
    sheet = screen.getByRole('dialog', { name: 'Final score' });
    const ours = within(sheet).getByRole('textbox', { name: 'Our team' });
    await user.type(ours, '42');

    land(); // within SAVE_ALL_WAIT_MS
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
    await afterDoubleTapWindow();
    expect(router.state.location.pathname).toBe(paths.trackGame(game.id));
    expect((await getGame(game.id))?.status).toBe('live');
    expect(screen.getByRole('dialog', { name: 'Final score' })).toBe(sheet);
    expect(ours).toHaveValue('42');

    // The sheet on screen ends it, with its own score.
    await user.click(within(sheet).getByRole('button', { name: 'End game' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(game.id)));
    expect(await getGame(game.id)).toMatchObject({ status: 'final', teamScore: 42 });
  });

  it('never takes the parent to the report for a Done left behind for Games', async () => {
    const game = await newGame();
    await endGame(game.id, { teamScore: 40, opponentScore: 31 });
    const { user, router } = await renderTracking(game);
    const land = slowNextSave();
    fireEvent.click(statButton('Steal'));

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await user.click(screen.getByRole('link', { name: 'Games' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.home));
    land();
    await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl']));
    await afterDoubleTapWindow();
    expect(router.state.location.pathname).toBe(paths.home);
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

    it('keeps counting it when the app-wide retry saves it: the points never dip', async () => {
      const game = await newGame();
      await recordStat(game.id, 'fg2_made');
      await renderTracking(game);
      await expectStrip('Points: 2');
      // Not saved at the tap, nor by the screen's own retry a moment later.
      const failing = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Connection lost'));
      fireEvent.click(statButton('2PT Made'));
      await expectStrip('Points: 4');
      await waitFor(() => expect(failing).toHaveBeenCalledTimes(2), {
        timeout: AUTO_RETRY_MS + 2000,
      });
      await waitFor(() => expect(notSaved()).toHaveTextContent('2PT Made not saved'));

      // Every value the strip shows from here on.
      const shown: string[] = [];
      const points = () => within(strip()).getByText(/^Points: /).textContent ?? '';
      const observer = new MutationObserver(() => shown.push(points()));
      observer.observe(strip(), { subtree: true, childList: true, characterData: true });
      try {
        failing.mockRestore();
        // The app-wide retry's next try saves it from the journal.
        await act(() => retryPendingStats());
        expect(await eventTypes(game.id)).toEqual(['fg2_made', 'fg2_made']);
        await waitFor(() => expect(notSaved()).not.toBeInTheDocument());
        await expectStrip('Points: 4');
      } finally {
        observer.disconnect();
      }
      expect(shown.filter((text) => text !== 'Points: 4')).toEqual([]);
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

    it('forgets it once its data is erased, even when the same sample game is back', async () => {
      await seedDemoData({ force: true });
      const gameId = demoGameId(10);
      const before = await eventTypes(gameId);
      const { user, router } = renderRoute(paths.trackGame(gameId));
      await screen.findByRole('group', { name: 'Record a stat' });
      const failing = vi.spyOn(repo, 'recordStat').mockRejectedValue(new Error('Lost'));
      fireEvent.click(statButton('Turnover'));
      await screen.findByRole('alert');
      await user.click(screen.getByRole('button', { name: 'Done' }));
      const sheet = await screen.findByRole('dialog', { name: "1 stat isn't saved yet" });
      await user.click(within(sheet).getByRole('button', { name: 'Done anyway' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(paths.gameReport(gameId)));
      failing.mockRestore();

      // Settings: Erase all data, then "Try it with sample data" (the same game ids).
      await clearAllData();
      await seedDemoData({ force: true });
      // Saving what's pending (while the app is open, or at the next start) adds nothing.
      await retryPendingStats();
      expect(await eventTypes(gameId)).toEqual(before);

      // Its live game screen starts afresh: nothing "not saved", nothing extra counted.
      await act(() => router.navigate(paths.trackGame(gameId)));
      await screen.findByRole('group', { name: 'Record a stat' });
      expect(notSaved()).not.toBeInTheDocument();
      await expectStrip(`Turnovers: ${before.filter((type) => type === 'tov').length}`);
    });
  });

  describe('when the saved stats cannot be read', () => {
    const CANT_READ = "Can't read saved stats right now.";
    const lost = () =>
      new DOMException('Connection to Indexed Database server lost.', 'UnknownError');
    const readNote = () => screen.queryByText(CANT_READ);

    beforeEach(() => {
      // Each failed read is logged; that's expected here.
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('stays up with what it read last, still counts and keeps taps, and reads again once it can', async () => {
      const game = await newGame();
      await recordStat(game.id, 'stl');
      await renderTracking(game);
      await expectStrip('Steals: 1');

      // Reading the stats fails from now on (as when WebKit loses its connection); the
      // next tap's save lands, and the screen can't read it back.
      const reads = vi.spyOn(repo, 'getGameEvents').mockRejectedValue(lost());
      fireEvent.click(statButton('Steal'));
      expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
      expect(screen.getByText('Your taps are kept on this phone.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeEnabled();
      expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
      // Over the strip, which is compact beside the shot chart's court.
      expect(screen.getByText(CANT_READ).closest('div')).toHaveClass('row', 'compact');
      await expectStrip('Steals: 2');

      // Saves fail now too: a tap still counts, at once, and is kept on the phone.
      const saves = vi.spyOn(repo, 'recordStat').mockRejectedValue(lost());
      fireEvent.click(statButton('Block'));
      expect(lastAction()).toHaveTextContent('Block · Q1');
      await expectStrip('Blocks: 1');
      await waitFor(() => expect(notSaved()).not.toBeInTheDocument());
      expect(listPendingStats().map((stat) => stat.type)).toEqual(['blk']);
      expect(readNote()).toBeInTheDocument();

      // The database works again, and the app comes back into view: it reads again (and
      // saves the Block), without a reload.
      reads.mockRestore();
      saves.mockRestore();
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitFor(() => expect(readNote()).not.toBeInTheDocument());
      await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl', 'stl', 'blk']));
      await expectStrip('Steals: 2', 'Blocks: 1');
      expect(listPendingStats()).toEqual([]);
      expect(notSaved()).not.toBeInTheDocument();
    });

    it('reads again on its own a moment later', async () => {
      const game = await newGame();
      await renderTracking(game);
      vi.spyOn(repo, 'getGameEvents').mockRejectedValueOnce(lost());
      fireEvent.click(statButton('Assist'));
      expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
      await waitFor(() => expect(readNote()).not.toBeInTheDocument(), {
        timeout: (READ_RETRY_DELAYS_MS[0] ?? 0) + 2000,
      });
      await expectStrip('Assists: 1');
    });

    it("never offers Reload while a tap isn't kept on the phone: it would lose it", async () => {
      const game = await newGame();
      await renderTracking(game);
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });
      vi.spyOn(repo, 'getGameEvents').mockRejectedValue(lost());
      fireEvent.click(statButton('Steal')); // saved (but not kept); reading it back fails
      expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
      // Saved: a reload loses nothing.
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

      vi.spyOn(repo, 'recordStat').mockRejectedValue(lost());
      fireEvent.click(statButton('Block')); // neither saved nor kept
      expect(screen.getByText('Keep the app open until your taps are saved.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
      // Once its save has failed, its own row says so.
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Block not saved It's not kept on this phone. Keep the app open until it's saved.",
      );
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    });

    it('keeps offering Reload through an Undo it can not finish yet: the removal is kept, and a reload finishes it', async () => {
      const game = await newGame();
      const { unmount } = await renderTracking(game);
      const savedTypes = async () =>
        (await db.events.where('gameId').equals(game.id).toArray()).map((event) => event.type);
      // Reads fail from now on, and the 3PT Made's write lands but the page hears it failed.
      vi.spyOn(repo, 'getGameEvents').mockRejectedValue(lost());
      const { recordStat: save } = repo;
      vi.spyOn(repo, 'recordStat').mockImplementationOnce(async (...args) => {
        await save(...args);
        throw lost();
      });
      fireEvent.click(statButton('3PT Made'));
      expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
      await waitFor(() => expect(lastAction()).toHaveTextContent('3PT Made not saved'));

      // Removing it fails too. The line says it's removed, and it no longer counts. Its
      // stat is still saved, but its removal is kept on the phone: a reload would still
      // remove it, so Reload stays.
      const deletes = vi.spyOn(repo, 'deleteStat').mockRejectedValue(lost());
      await tapLineButton();
      expect(lastAction()).toHaveTextContent('Removed 3PT Made');
      await expectStrip('3-pointers: 0 of 0');
      await waitFor(() => expect(deletes).toHaveBeenCalled());
      expect(await savedTypes()).toEqual(['fg3_made']);
      expect(listPendingRemovals().map((removal) => removal.type)).toEqual(['fg3_made']);
      expect(screen.getByText('Your taps are kept on this phone.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

      // Reload: the page (and all it held) is gone, and the app's next start removes it.
      unmount();
      disposeTrackingSessions();
      deletes.mockRestore();
      await replayPendingStats();
      expect(await savedTypes()).toEqual([]);
      expect(listPendingRemovals()).toEqual([]);
      expect(listPendingStats()).toEqual([]);
    });

    it('keeps offering Reload through an Undo during an outage, for as long as it lasts', async () => {
      const game = await newGame();
      await renderTracking(game);
      // Reads fail from now on; the Steal's save lands but can't be read back.
      vi.spyOn(repo, 'getGameEvents').mockRejectedValue(lost());
      fireEvent.click(statButton('Steal'));
      expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

      // The connection is lost: every write fails too. The Block is kept.
      vi.spyOn(repo, 'recordStat').mockRejectedValue(lost());
      const deletes = vi.spyOn(repo, 'deleteStat').mockRejectedValue(lost());
      fireEvent.click(statButton('Block'));
      await waitFor(() => expect(listPendingStats().map((stat) => stat.type)).toEqual(['blk']));
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

      // Wrong stat: Undo. It's taken back at once; removing its stat by id (in case its
      // save landed) fails like every write, and is kept for after a reload. Nothing is
      // lost, and the note says so.
      fireEvent.click(screen.getByRole('button', { name: 'Undo last stat' }));
      await waitFor(() => expect(lastAction()).toHaveTextContent('Removed Block'));
      await expectStrip('Blocks: 0', 'Steals: 1');
      await waitFor(() => expect(deletes).toHaveBeenCalled());
      expect(listPendingStats()).toEqual([]);
      expect(listPendingRemovals().map((removal) => removal.type)).toEqual(['blk']);
      expect(screen.getByText('Your taps are kept on this phone.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

      // The app comes back to the front, and the removal is tried again (and fails): still
      // nothing to lose.
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitFor(() => expect(deletes).toHaveBeenCalledTimes(2));
      expect(screen.getByText(CANT_READ)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(screen.queryByText('Keep the app open until your taps are saved.')).toBeNull();

      // Writes work again: the removal is done (nothing was there) and forgotten.
      deletes.mockRestore();
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitFor(() => expect(listPendingRemovals()).toEqual([]));
      expect((await db.events.toArray()).map((event) => event.type)).toEqual(['stl']);
    });

    it("doesn't offer Reload while another game has a tap that's neither saved nor kept", async () => {
      const gameA = await newGame({ opponent: 'Alpha' });
      const gameB = await newGame({ opponent: 'Bravo' });
      const { router } = await renderTracking(gameA);
      // localStorage is full and saves fail: game A's Steal lives only in memory.
      const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      });
      const failing = vi.spyOn(repo, 'recordStat').mockRejectedValue(lost());
      fireEvent.click(statButton('Steal'));
      expect(await screen.findByRole('alert')).toHaveTextContent("It's not kept on this phone.");

      // On to game B's live screen, where reading then fails.
      await act(() => router.navigate(paths.trackGame(gameB.id)));
      await screen.findByRole('heading', { name: 'vs Bravo' });
      vi.spyOn(repo, 'getGame').mockRejectedValue(lost());
      await act(() => setCurrentPeriod(gameB.id, 2));
      expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
      // A reload would lose game A's Steal.
      expect(screen.getByText('Keep the app open until your taps are saved.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();

      // The app-wide retry saves it: now a reload would lose nothing, and the screen says
      // so at once (game B's stats still can't be read).
      full.mockRestore();
      failing.mockRestore();
      await act(() => retryPendingStats());
      expect(await eventTypes(gameA.id)).toEqual(['stl']);
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
      expect(screen.getByText('Your taps are kept on this phone.')).toBeInTheDocument();
    });

    describe("when the database can't be opened again (WebKit lost its connection)", () => {
      /**
       * Dexie closes the database (as its onclose handler does when WebKit loses the
       * connection), and every open fails until `restore()`: the next read or write that
       * opens it fails, and Dexie gives up on it for good.
       */
      function loseConnection() {
        const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
          throw lost();
        });
        db.close({ disableAutoOpen: false });
        return { restore: () => open.mockRestore() };
      }

      beforeEach(() => {
        // Dexie warns as it works around a failed open; that's expected here.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
      });

      it('says so, with Reload, and carries on once it opens again, without a reload', async () => {
        setReopenDelaysForTests([100]);
        const game = await newGame();
        await recordStat(game.id, 'stl');
        await renderTracking(game);
        await expectStrip('Steals: 1');
        const connection = loseConnection();

        // A tap still counts, and is kept. Its save can't open the database: the screen
        // says it can't read the saved stats, calmly, and offers Reload (the Block is kept).
        fireEvent.click(statButton('Block'));
        await expectStrip('Steals: 1', 'Blocks: 1');
        expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
        expect(screen.getByText('Your taps are kept on this phone.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
        expect(listPendingStats().map((stat) => stat.type)).toEqual(['blk']);
        expect(lastAction()).toHaveTextContent('Block not saved');

        // The connection is back: the database opens again on its own, the stats are read
        // again, and the Block is saved. No reload, and nothing for the parent to do.
        connection.restore();
        await waitFor(() => expect(readNote()).not.toBeInTheDocument());
        await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl', 'blk']));
        await waitFor(() => expect(notSaved()).not.toBeInTheDocument());
        await expectStrip('Steals: 1', 'Blocks: 1');
        expect(listPendingStats()).toEqual([]);
        fireEvent.click(statButton('Assist'));
        await waitFor(async () => expect(await eventTypes(game.id)).toEqual(['stl', 'blk', 'ast']));
      });

      it('says so when the app comes back into view, though nothing was tapped', async () => {
        const game = await newGame();
        await recordStat(game.id, 'stl');
        await renderTracking(game);
        const connection = loseConnection();
        // The screen reads again as the app comes back into view: that read opens the
        // database, which fails.
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        });
        expect(await screen.findByText(CANT_READ)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
        await expectStrip('Steals: 1');

        // Shown again once the connection is back: it opens again at once.
        connection.restore();
        act(() => {
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await waitFor(() => expect(readNote()).not.toBeInTheDocument());
        await expectStrip('Steals: 1');
      });
    });

    it("stays up if the Shot chart setting can't be read again", async () => {
      const game = await newGame();
      await renderTracking(game);
      expect(screen.getByRole('img', { name: /^Shot spot/ })).toBeInTheDocument();
      // A settings change makes the screen read them again, and that read fails.
      const reads = vi.spyOn(repo, 'getSettings').mockRejectedValue(lost());
      await act(() => updateSettings({ shotChart: false }));
      await waitFor(() => expect(reads).toHaveBeenCalled());
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
      // The court stays as the screen opened: it never comes or goes mid-game.
      expect(screen.getByRole('img', { name: /^Shot spot/ })).toBeInTheDocument();
      fireEvent.click(statButton('Assist'));
      await expectStrip('Assists: 1');
    });

    it('reads again if the first read never answers (Dexie drops an aborted one without a word)', async () => {
      const game = await newGame();
      const reads = vi
        .spyOn(repo, 'getGame')
        .mockRejectedValueOnce(new DOMException('The transaction was aborted.', 'AbortError'));
      renderRoute(paths.trackGame(game.id));
      await waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('group', { name: 'Record a stat' })).toBeNull();

      expect(
        await screen.findByRole(
          'group',
          { name: 'Record a stat' },
          { timeout: READ_WATCHDOG_MS + 2000 },
        ),
      ).toBeInTheDocument();
      expect(readNote()).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
    });

    it('shows the error screen if even the first read fails: there is nothing to keep yet', async () => {
      const game = await newGame();
      vi.spyOn(repo, 'getGame').mockRejectedValue(lost());
      renderRoute(paths.trackGame(game.id));
      expect(
        await screen.findByRole('heading', { name: 'Something went wrong' }),
      ).toBeInTheDocument();
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

describe('TrackGameScreen shot chart', () => {
  // Spots in feet from the basket: a 2 from the left elbow, a layup, a corner 3.
  const ELBOW: CourtPoint = { x: -6, y: 13.75 };
  const LAYUP: CourtPoint = { x: 1, y: 2 };
  const CORNER: CourtPoint = { x: 23, y: -3 };

  const court = () => screen.getByRole('img', { name: /^Shot spot/ });
  const queryCourt = () => screen.queryByRole('img', { name: /^Shot spot/ });
  /** The court's box: it's outlined while a tap on it marks a shot's spot. */
  const courtArea = () => court().parentElement;
  /** The last-action line's note under its message (e.g. "Spot marked"). */
  const lineNote = () => lastAction().querySelector('[aria-hidden="true"]:not(.dot)');

  /** Taps the court at `point` (feet). jsdom does no layout, so its box is made up. */
  function tapCourt(point: CourtPoint) {
    const svg = court();
    const placement = { scale: 0.7, left: 8, top: 120, viewBox: courtViewBox(COURT_DEPTH) };
    mockScreenBox(svg, courtBox(placement));
    const pointer = {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      ...svgToClient(courtToSvg(point), placement),
    };
    fireEvent.pointerDown(svg, pointer);
    fireEvent.pointerUp(svg, pointer);
  }

  async function eventSpots(gameId: string) {
    return (await getGameEvents(gameId)).map((event) => [event.type, event.location]);
  }

  it('shows the court only with Shot chart on, above the buttons, with the strip compact', async () => {
    const game = await newGame();
    await renderTracking(game);
    const main = screen.getByRole('main');
    // Between the stat strip and the grid, from the start.
    expect(court().compareDocumentPosition(grid()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      court().compareDocumentPosition(strip()) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(main).toHaveClass('withCourt');
    // One row of points, fouls and shooting: the other counts are on their buttons.
    expect(strip()).toHaveClass('compact');
    expect(court()).toHaveAccessibleName(
      'Shot spot (optional): tap 2PT or 3PT first. Tap where the shot was taken.',
    );
    // Quick taps on it never scroll or zoom the page.
    expect(court()).toHaveClass('touchNone');
  });

  it('with Shot chart off, keeps the layout exactly as it was', async () => {
    await updateSettings({ shotChart: false });
    const game = await newGame();
    await renderTracking(game);
    const main = screen.getByRole('main');

    expect(queryCourt()).not.toBeInTheDocument();
    expect(main).toHaveClass('screen', { exact: true });
    expect(strip()).toHaveClass('strip', { exact: true });
    expect(
      within(strip())
        .getAllByRole('listitem')
        .map((item) => item.className),
    ).toEqual([
      'item points',
      'item',
      'item',
      'item',
      'item',
      'item',
      'item',
      'item shooting',
      'item shooting',
      'item shooting',
    ]);
    // Top bar, stat strip, grid, last-action line and bottom bar: nothing else.
    expect(Array.from(main.children, (child) => child.className || child.tagName)).toEqual([
      'bar',
      'stripArea',
      'grid',
      'line',
      'bottomBar',
    ]);

    fireEvent.click(statButton('2PT Made'));
    expect(lastAction()).toHaveTextContent(/^2PT Made · Q1$/);
    expect(lineNote()).toBeNull();
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([['fg2_made', undefined]]));
  });

  it('marks where a shot was taken: its button, then the court (again to move it)', async () => {
    const game = await newGame();
    await renderTracking(game);

    fireEvent.click(statButton('2PT Made'));
    // Saved at the tap, as always; the court is optional.
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([['fg2_made', undefined]]));
    expect(lastAction()).toHaveTextContent('2PT Made · Q1');
    expect(lineNote()).toHaveTextContent('Tap the court to mark the spot');
    expect(courtArea()).toHaveClass('open');
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 2PT Made (optional). Tap where the shot was taken.',
    );

    tapCourt(ELBOW);
    expect(lineNote()).toHaveTextContent('Spot marked');
    expect(within(court()).getByText('2PT')).toBeInTheDocument();
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 2PT Made (optional). Picked: 2-pointer, 15 feet from the basket.',
    );
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([['fg2_made', ELBOW]]));

    // A second tap moves it: still one stat.
    tapCourt(LAYUP);
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([['fg2_made', LAYUP]]));
    expect(listPendingStats()).toEqual([]);
    expect(listPendingSpots()).toEqual([]);
    await expectStrip('Points: 2', 'Field goals: 1 of 1');

    // The next stat closes the court: a tap on it then marks nothing, and says why.
    fireEvent.click(statButton('Def Reb'));
    expect(lastAction()).toHaveTextContent(/^Def Reb · Q1$/);
    expect(courtArea()).not.toHaveClass('open');
    tapCourt(ELBOW);
    expect(within(courtArea() as HTMLElement).getByText('Tap 2PT or 3PT first')).toBeVisible();
    await waitFor(async () =>
      expect(await eventSpots(game.id)).toEqual([
        ['fg2_made', LAYUP],
        ['dreb', undefined],
      ]),
    );
    // The marked shot now shows faintly with the others.
    expect(court().querySelectorAll('circle.made')).toHaveLength(1);
  });

  it('never gives a free throw a spot', async () => {
    const game = await newGame();
    await renderTracking(game);
    fireEvent.click(statButton('FT Made'));
    expect(lineNote()).toBeNull();
    expect(courtArea()).not.toHaveClass('open');
    tapCourt(LAYUP);
    expect(within(courtArea() as HTMLElement).getByText('Tap 2PT or 3PT first')).toBeVisible();
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([['ft_made', undefined]]));
  });

  it('notes a spot on the other side of the arc, and counts the button tapped', async () => {
    const game = await newGame();
    await renderTracking(game);
    fireEvent.click(statButton('2PT Miss'));
    tapCourt(CORNER);
    expect(lineNote()).toHaveTextContent('Spot marked · beyond the arc');
    // The court names the shot as tapped: a 2PT, from beyond the arc.
    expect(within(court()).getByText('2PT')).toBeInTheDocument();
    expect(within(court()).queryByText('3PT')).not.toBeInTheDocument();
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 2PT Miss (optional). Picked: 2-pointer, 23 feet from the basket.',
    );
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([['fg2_miss', CORNER]]));
    await expectStrip('Field goals: 0 of 1', '3-pointers: 0 of 0');

    fireEvent.click(statButton('3PT Made'));
    tapCourt(LAYUP);
    expect(lineNote()).toHaveTextContent('Spot marked · inside the arc');
    expect(within(court()).getByText('3PT')).toBeInTheDocument();
    expect(court()).toHaveAccessibleName(
      'Shot spot of the 3PT Made (optional). Picked: 3-pointer, 2 feet from the basket.',
    );
  });

  it("the line's Undo takes the shot back, spot and all", async () => {
    const game = await newGame();
    await renderTracking(game);
    fireEvent.click(statButton('3PT Made'));
    tapCourt(CORNER);
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([['fg3_made', CORNER]]));

    await tapLineButton();
    await waitFor(() => expect(lastAction()).toHaveTextContent('Removed 3PT Made'));
    expect(courtArea()).not.toHaveClass('open');
    await waitFor(async () => expect(await eventSpots(game.id)).toEqual([]));
    expect(listPendingStats()).toEqual([]);
    expect(listPendingSpots()).toEqual([]);
    await expectStrip('Points: 0');
  });

  it('keeps the spot of a shot that could not be saved with it, and saves both, once', async () => {
    const game = await newGame();
    await renderTracking(game);
    // The shot's save fails, and so does the retry the timer makes.
    const { recordStat: save } = repo;
    let failing = true;
    vi.spyOn(repo, 'recordStat').mockImplementation((...args) =>
      failing ? Promise.reject(new Error('Connection lost')) : save(...args),
    );
    fireEvent.click(statButton('2PT Made'));
    expect(await screen.findByRole('alert')).toHaveTextContent('2PT Made not saved');

    tapCourt(ELBOW);
    expect(lineNote()).toHaveTextContent('Spot marked');
    // On the phone with the tap until it's saved.
    expect(listPendingStats().map((stat) => [stat.type, stat.location])).toEqual([
      ['fg2_made', ELBOW],
    ]);

    failing = false;
    const retry = screen.getByRole('button', { name: 'Retry' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(notSaved()).not.toBeInTheDocument());
    expect(await eventSpots(game.id)).toEqual([['fg2_made', ELBOW]]);
    expect(listPendingStats()).toEqual([]);
    expect(listPendingSpots()).toEqual([]);
  });

  it('keeps the court while the screen is open, even if the setting changes meanwhile', async () => {
    const game = await newGame();
    await renderTracking(game);
    await act(() => updateSettings({ shotChart: false }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(court()).toBeInTheDocument();
  });

  it('pins the shots with a spot in the log', async () => {
    const game = await newGame();
    await recordStat(game.id, 'fg2_made', ELBOW);
    await recordStat(game.id, 'fg3_miss');
    const { user } = await renderTracking(game);
    await user.click(screen.getByRole('button', { name: 'Log' }));
    const log = await screen.findByRole('dialog', { name: 'Stat log' });
    expect(within(log).getByRole('button', { name: /^2PT Made, spot marked/ })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: /^3PT Miss/ })).not.toHaveAccessibleName(/spot/);
  });
});
