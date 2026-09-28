import { expect, type Page } from '@playwright/test';
import { paths } from '../../src/routes';
import { appUrl } from './app';
import { clearAllData, exportAll, seedDemoData } from './data';

/** Id of the nth of the parent's own games from `seedOwnGames`: 1 is the oldest, 10 the newest. */
export function ownGameId(n: number): string {
  return `own-game-${String(n).padStart(2, '0')}`;
}

/**
 * Ten games of the parent's own ("Ava" #12): the demo season under ids that aren't
 * sample-data ids, since cloud backup's shrink guard ignores sample games. They're
 * restored from a backup file through Settings, like a parent would, which leaves the
 * page on Settings. Call it on a phone with no data yet.
 */
export async function seedOwnGames(page: Page): Promise<void> {
  await seedDemoData(page);
  const demo = await exportAll(page);
  const own = (id: string) => id.replace(/^demo-/, 'own-');
  const file = {
    ...demo,
    games: demo.games.map((game) => ({ ...game, id: own(game.id) })),
    events: demo.events.map((event) => ({ ...event, gameId: own(event.gameId) })),
  };
  await clearAllData(page);

  await page.goto(appUrl(paths.settings));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore from a backup file' }).tap();
  await (
    await chooser
  ).setFiles({
    name: 'hoop-stats-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await page
    .getByRole('dialog', { name: 'Restore this backup?' })
    .getByRole('button', { name: 'Restore backup' })
    .tap();
  await expect(page.getByRole('list', { name: 'Player' })).toContainText('Ava');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
