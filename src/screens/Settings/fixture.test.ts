import { describe, expect, it } from 'vitest';
import { computeStatLine } from '@/data/stats';
import { parseExportFile } from '@/data/transfer';
import fixtureJson from '../../../e2e/fixtures/settings-backup.json?raw';
import { describeBackup, formatDayWithYear } from './backupFiles';

// The backup file the e2e restore test picks. If the backup format changes, update it.
describe('e2e/fixtures/settings-backup.json', () => {
  it('is a valid backup with two finished games for Maya #7', () => {
    const backup = parseExportFile(fixtureJson);
    expect(backup.games.map((game) => [game.opponent, game.status])).toEqual([
      ['Hillcrest', 'final'],
      ['Brookside', 'final'],
    ]);
    // Saved at noon UTC: Sep 20 in every US time zone.
    expect(describeBackup(backup)).toBe(
      `Backup from ${formatDayWithYear(Date.parse(backup.exportedAt))} · 2 games · Maya #7`,
    );
    const points = backup.games.map(
      (game) => computeStatLine(backup.events.filter((event) => event.gameId === game.id)).pts,
    );
    expect(points).toEqual([9, 3]);
  });
});
