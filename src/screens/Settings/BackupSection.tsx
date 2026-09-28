import { useRef, useState, type ChangeEvent } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { useToast } from '@/components/Toast/toastContext';
import { ExportFileError, NOT_A_BACKUP } from '@/data/transfer';
import type { Game } from '@/data/types';
import { ActionRow } from './ActionRow';
import {
  backupFileStatus,
  createBackupFile,
  createSpreadsheetFile,
  readBackupFile,
  readLastBackupFile,
  rememberBackupFile,
} from './backupFiles';
import { buildGamesCsv } from './gamesCsv';
import { RestoreSheet, type RestoreRequest } from './RestoreSheet';
import { saveFile, type SaveFileResult } from './saveFile';
import type { BackupSnapshot } from './useBackupSnapshot';

const SAVE_FAILED = "Couldn't save the file. Try again.";
const UNREADABLE = "This file couldn't be opened. Try choosing it again.";

export interface BackupSectionProps {
  games: readonly Game[];
  /** Everything on the phone, read ahead of time (see useBackupSnapshot). */
  snapshot: BackupSnapshot;
  /** Whether `snapshot` holds the latest change; saving waits until it does. */
  fresh: boolean;
  /** The snapshot if it's up to date at this very moment, for the tap handlers. */
  currentSnapshot: () => BackupSnapshot | undefined;
  /** Cloud backup is on, so the stats aren't only on this phone. */
  cloudBackupOn?: boolean;
}

/**
 * Backup files: save one (share sheet or download), restore one, and export the
 * games as a spreadsheet.
 */
export function BackupSection({
  games,
  snapshot,
  fresh,
  currentSnapshot,
  cloudBackupOn = false,
}: BackupSectionProps) {
  const toast = useToast();
  const [lastSaved, setLastSaved] = useState(readLastBackupFile);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreRequest, setRestoreRequest] = useState<RestoreRequest | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const { file: data } = snapshot;
  const hasData = data.games.length > 0 || data.players.length > 0;
  const hasFinalGames = data.games.some((game) => game.status === 'final');

  /** Opens the share sheet (or downloads) with a file built right now, from the tap. */
  const share = async (file: File): Promise<SaveFileResult> => {
    sharingRef.current = true;
    setSharing(true);
    try {
      return await saveFile(file);
    } finally {
      sharingRef.current = false;
      setSharing(false);
    }
  };

  const saveBackup = async () => {
    // Read at the tap: a write may have landed since this render. Then the data is
    // being read again and the row is about to turn off, so nothing is saved.
    const current = currentSnapshot();
    if (!current || sharingRef.current) return;
    const now = new Date();
    // Stamped with when the data was read (its exportedAt), named for the day it's saved.
    const result = await share(createBackupFile(current.file, now));
    if (result === 'shared' || result === 'downloaded') {
      const saved = { savedAt: now.getTime(), lastChangeAt: current.lastChangeAt };
      rememberBackupFile(saved);
      setLastSaved(saved);
      toast.show({ message: result === 'shared' ? 'Backup file saved' : 'Backup file downloaded' });
    } else if (result === 'failed') {
      toast.show({ message: SAVE_FAILED });
    }
  };

  const exportSpreadsheet = async () => {
    const current = currentSnapshot();
    if (!current || sharingRef.current) return;
    const csv = buildGamesCsv(current.file.games, current.file.events);
    const result = await share(createSpreadsheetFile(csv, new Date()));
    if (result === 'shared') toast.show({ message: 'Spreadsheet saved' });
    else if (result === 'downloaded') toast.show({ message: 'Spreadsheet downloaded' });
    else if (result === 'failed') toast.show({ message: SAVE_FAILED });
  };

  const showRestore = (request: RestoreRequest) => {
    setRestoreRequest(request);
    setRestoreOpen(true);
  };

  const handleFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Cleared, so picking the same file again still counts as a change.
    input.value = '';
    if (!file) return;
    try {
      const backup = await readBackupFile(file);
      showRestore({ kind: 'preview', backup, phoneGameCount: games.length });
    } catch (error) {
      if (!(error instanceof ExportFileError)) console.error('Reading a backup file failed', error);
      const message = error instanceof ExportFileError ? error.message : UNREADABLE;
      // Only a file that isn't a backup at all gets the "choose a Hoop Stats backup" hint:
      // it would contradict "update the app", "too big" or "try choosing it again".
      showRestore({ kind: 'error', message, notABackup: message === NOT_A_BACKUP });
    }
  };

  const saveSubtitle = backupFileStatus(lastSaved, {
    hasData,
    lastChangeAt: snapshot.lastChangeAt,
  });

  return (
    <div>
      <GroupedList
        header="Backup"
        footer={
          cloudBackupOn
            ? 'For a copy you keep yourself, save a backup file now and then (to Files, iCloud Drive or email).'
            : 'Your stats are stored only on this phone. Save a backup file now and then (to Files, iCloud Drive or email) so you can always get them back.'
        }
      >
        <ActionRow
          title="Save a backup file"
          subtitle={saveSubtitle}
          onClick={saveBackup}
          disabled={!fresh || !hasData || sharing}
        />
        <ActionRow
          title="Restore from a backup file"
          onClick={() => fileInputRef.current?.click()}
          disabled={sharing}
        />
        <ActionRow
          title="Export spreadsheet (CSV)"
          subtitle={
            hasFinalGames
              ? 'One row per finished game, for Numbers or Excel'
              : 'Available once a game is finished'
          }
          onClick={exportSpreadsheet}
          disabled={!fresh || !hasFinalGames || sharing}
        />
      </GroupedList>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        aria-label="Backup file to restore"
        hidden
        onChange={handleFileChosen}
      />
      <RestoreSheet
        open={restoreOpen}
        request={restoreRequest}
        onClose={() => setRestoreOpen(false)}
      />
    </div>
  );
}
