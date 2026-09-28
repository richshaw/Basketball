import { expect, test } from '@playwright/test';
import { screenHeading } from './support/app';
import {
  clearAllData,
  DEMO_LIVE_GAME_ID,
  demoGameId,
  exportAll,
  seedDemoData,
} from './support/data';

test('keeps data on the device across reloads', async ({ page }) => {
  await page.goto('./');
  await expect(screenHeading(page, 'Games')).toBeVisible();

  await seedDemoData(page, { liveGame: true });
  const seeded = await exportAll(page);
  expect(seeded.players).toEqual([expect.objectContaining({ name: 'Ava', jerseyNumber: '12' })]);
  expect(seeded.games.map((game) => game.id)).toEqual([
    ...Array.from({ length: 10 }, (_, index) => demoGameId(index + 1)),
    DEMO_LIVE_GAME_ID,
  ]);
  expect(seeded.games.filter((game) => game.status === 'final')).toHaveLength(10);
  expect(seeded.events.length).toBeGreaterThan(200);

  await page.reload();
  await expect(screenHeading(page, 'Games')).toBeVisible();
  const reloaded = await exportAll(page);
  expect({ ...reloaded, exportedAt: '' }).toEqual({ ...seeded, exportedAt: '' });

  await clearAllData(page);
  expect(await exportAll(page)).toMatchObject({ players: [], games: [], events: [] });
});
