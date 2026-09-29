import { db } from '@/data/db';

/**
 * Empties every table, so the next test starts with a blank database. A test that closed
 * the database for good (as after WebKit loses its connection and can't open it again:
 * see src/data/reopen.ts) may have left it closed: it's opened again first.
 */
export async function resetDatabase(): Promise<void> {
  if (db.hasFailed()) db.close({ disableAutoOpen: false });
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}
