import { describe, expect, it } from 'vitest';
import { isOnHalfCourt, isThreePoint } from '@/lib/court';
import { todayLocalISO } from '@/lib/format';
import { buildDemoData, DEMO_LIVE_GAME_ID, DEMO_SEASON, demoGameId, seedDemoData } from './demo';
import { createGame, getGame, getLiveGame, getPlayer, listGames, savePlayer } from './repo';
import { computeStatLine, gameResult, groupEventsByGame, isFieldGoalType } from './stats';
import { exportAll, parseExportFile } from './transfer';

const TODAY = '2026-09-28';
const demo = buildDemoData({ today: TODAY });

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

describe('buildDemoData', () => {
  it('is the same every time', () => {
    expect(buildDemoData({ today: TODAY })).toEqual(demo);
  });

  it('is a valid backup', () => {
    expect(parseExportFile(demo)).toEqual(demo);
  });

  it('has Ava #12 and ten final Fall 2026 games from the past two months', () => {
    expect(demo.players).toEqual([
      expect.objectContaining({ name: 'Ava', jerseyNumber: '12' }) as unknown,
    ]);
    expect(demo.games).toHaveLength(10);
    expect(demo.games.map((g) => g.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => demoGameId(index + 1)),
    );
    expect(new Set(demo.games.map((g) => g.opponent)).size).toBe(10);
    for (const game of demo.games) {
      expect(game).toMatchObject({
        status: 'final',
        season: DEMO_SEASON,
        periodFormat: 'quarters',
        currentPeriod: 4,
      });
      const daysAgo = daysBetween(game.date, TODAY);
      expect(daysAgo).toBeGreaterThanOrEqual(1);
      expect(daysAgo).toBeLessThanOrEqual(62);
    }
    expect(demo.settings?.lastSeason).toBe(DEMO_SEASON);
  });

  it('has mostly wins and a few losses, with sensible scores', () => {
    const results = demo.games.map(gameResult);
    expect(results.filter((r) => r === 'W')).toHaveLength(7);
    expect(results.filter((r) => r === 'L')).toHaveLength(3);

    const byGame = groupEventsByGame(demo.events);
    for (const game of demo.games) {
      const line = computeStatLine(byGame.get(game.id) ?? []);
      expect(game.teamScore).toBeGreaterThan(line.pts);
    }
  });

  it('has realistic high-school numbers in every game', () => {
    const byGame = groupEventsByGame(demo.events);
    for (const game of demo.games) {
      const line = computeStatLine(byGame.get(game.id) ?? []);
      expect(line.pts, game.id).toBeGreaterThanOrEqual(6);
      expect(line.pts, game.id).toBeLessThanOrEqual(18);
      expect(line.reb, game.id).toBeGreaterThanOrEqual(2);
      expect(line.reb, game.id).toBeLessThanOrEqual(9);
      expect(line.ast, game.id).toBeLessThanOrEqual(5);
      expect(line.stl, game.id).toBeLessThanOrEqual(4);
      expect(line.pf, game.id).toBeLessThanOrEqual(4);
    }
    const season = computeStatLine(demo.events);
    for (const stat of ['blk', 'tov', 'pf', 'deflections', 'charges', 'fg3m', 'ftm'] as const) {
      expect(season[stat], stat).toBeGreaterThan(0);
    }
  });

  it('spreads each game over four quarters, in order', () => {
    const byGame = groupEventsByGame(demo.events);
    for (const game of demo.games) {
      const events = byGame.get(game.id) ?? [];
      expect(new Set(events.map((e) => e.period))).toEqual(new Set([1, 2, 3, 4]));
      events.forEach((event, index) => {
        const previous = events[index - 1];
        if (previous) {
          expect(event.createdAt).toBeGreaterThan(previous.createdAt);
          expect(event.period).toBeGreaterThanOrEqual(previous.period);
        }
        expect(event.createdAt).toBeGreaterThan(game.createdAt);
        expect(event.createdAt).toBeLessThan(game.endedAt ?? 0);
      });
    }
  });

  it('puts every shot location where that shot is worth its points', () => {
    const fieldGoals = demo.events.filter((e) => isFieldGoalType(e.type));
    const located = fieldGoals.filter((e) => e.location);
    expect(located.length / fieldGoals.length).toBeGreaterThan(0.7);
    expect(located.length).toBeLessThan(fieldGoals.length);

    for (const event of demo.events) {
      if (!event.location) continue;
      expect(isFieldGoalType(event.type), event.id).toBe(true);
      expect(isOnHalfCourt(event.location), event.id).toBe(true);
      const three = event.type === 'fg3_made' || event.type === 'fg3_miss';
      expect(isThreePoint(event.location), event.id).toBe(three);
    }
  });

  it('counts back from today by default', () => {
    const games = buildDemoData().games;
    const newest = games.at(-1)?.date ?? '';
    expect(daysBetween(newest, todayLocalISO())).toBeGreaterThan(0);
    expect(daysBetween(newest, todayLocalISO())).toBeLessThan(7);
  });

  it('can add a live game in the third quarter', () => {
    const withLive = buildDemoData({ today: TODAY, liveGame: true });
    expect(withLive.games.slice(0, 10)).toEqual(demo.games);
    const live = withLive.games[10];
    expect(live).toMatchObject({
      id: DEMO_LIVE_GAME_ID,
      status: 'live',
      date: TODAY,
      currentPeriod: 3,
    });
    const events = withLive.events.filter((e) => e.gameId === DEMO_LIVE_GAME_ID);
    expect(events.length).toBeGreaterThan(5);
    expect(Math.max(...events.map((e) => e.period))).toBeLessThanOrEqual(3);
    expect(parseExportFile(withLive)).toEqual(withLive);
  });
});

describe('seedDemoData', () => {
  it('loads the demo data onto an empty device, and again over earlier demo data', async () => {
    await seedDemoData({ today: TODAY });
    expect((await getPlayer())?.name).toBe('Ava');
    expect(await listGames()).toHaveLength(10);
    expect(await getLiveGame()).toBeUndefined();
    expect((await exportAll()).events).toEqual(demo.events);

    await seedDemoData({ today: TODAY, liveGame: true });
    expect((await getLiveGame())?.id).toBe(DEMO_LIVE_GAME_ID);
  });

  it("refuses to replace the device's own data unless forced", async () => {
    const game = await createGame({
      opponent: 'Real opponent',
      date: '2026-09-27',
      periodFormat: 'quarters',
    });
    const before = await exportAll();

    await expect(seedDemoData({ today: TODAY })).rejects.toThrow(/force: true/);
    expect({ ...(await exportAll()), exportedAt: '' }).toEqual({ ...before, exportedAt: '' });

    await seedDemoData({ today: TODAY, force: true });
    expect(await getGame(game.id)).toBeUndefined();
    expect(await listGames()).toHaveLength(10);
  });

  it('counts a player set up on the device as its own data', async () => {
    await savePlayer({ name: 'Someone else' });
    await expect(seedDemoData({ today: TODAY })).rejects.toThrow(/own data/);
    expect((await getPlayer())?.name).toBe('Someone else');
  });
});
