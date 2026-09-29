import { useCallback, useEffect, useRef, useState } from 'react';
import { savePendingStatsBeforeExport } from '@/data/pendingSaves';
import { getLastChangeAt, subscribeToChanges } from '@/data/repo';
import { exportAll, type ExportFile } from '@/data/transfer';

/** Everything on the phone as a backup file holds it, and which version of the data it is. */
export interface BackupSnapshot {
  file: ExportFile;
  /** `meta.lastChangeAt` when it was read: undefined if the data never changed. */
  lastChangeAt: number | undefined;
}

export interface BackupSnapshotState {
  /** The latest snapshot, for display. Undefined until the first read. */
  snapshot: BackupSnapshot | undefined;
  /** False from the moment a write lands until it has been read: don't save meanwhile. */
  fresh: boolean;
  /**
   * The snapshot if it holds every change right now, else undefined. For tap handlers:
   * it's out of date the moment a write commits, even before React re-renders.
   */
  currentSnapshot: () => BackupSnapshot | undefined;
}

/**
 * Everything on the phone, read ahead of time: the share sheet only opens straight
 * from a tap, with no waiting on the database in between. Every write marks it out
 * of date at once (subscribeToChanges) and reads it again, so a tap can never save a
 * file that misses the newest change. First, the taps not saved yet (e.g. from a game
 * ended with "End anyway") are saved if the database takes them within a moment
 * (savePendingStatsBeforeExport), so the files have those stats too: until then the
 * snapshot is shown, but not fresh.
 */
export function useBackupSnapshot(): BackupSnapshotState {
  const [state, setState] = useState<{ snapshot?: BackupSnapshot; fresh: boolean }>({
    fresh: false,
  });
  const currentRef = useRef<BackupSnapshot | undefined>(undefined);

  useEffect(() => {
    let active = true;
    let changes = 0;
    let reading = false;
    // The taps not saved yet have been tried (or waited for long enough).
    let triedPending = false;

    const read = async () => {
      if (reading) return; // The loop below sees the new change and reads again.
      reading = true;
      try {
        let seen: number;
        let snapshot: BackupSnapshot;
        do {
          seen = changes;
          // Before exporting, so a write during the export can only make it look older.
          const lastChangeAt = await getLastChangeAt();
          snapshot = { file: await exportAll(), lastChangeAt };
          if (!active) return;
        } while (seen !== changes);
        // (A tap saved meanwhile is a change: the loop has read it.)
        currentRef.current = triedPending ? snapshot : undefined;
        setState({ snapshot, fresh: triedPending });
      } catch (error) {
        // Stays out of date (Save stays off); the next change tries again.
        console.error('Reading the data for a backup file failed', error);
      } finally {
        reading = false;
      }
    };

    const stop = subscribeToChanges(() => {
      changes += 1;
      currentRef.current = undefined;
      setState((current) => (current.fresh ? { ...current, fresh: false } : current));
      void read();
    });
    void read();
    void savePendingStatsBeforeExport().then(() => {
      triedPending = true;
      if (active) void read();
    });
    return () => {
      active = false;
      stop();
    };
  }, []);

  const currentSnapshot = useCallback(() => currentRef.current, []);
  return { snapshot: state.snapshot, fresh: state.fresh, currentSnapshot };
}
