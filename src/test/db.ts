import { db } from '@/data/db';

/** Empties every table, so the next test starts with a blank database. */
export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}
