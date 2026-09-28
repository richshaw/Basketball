import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { useToast } from '@/components/Toast/toastContext';
import { exportAll, ExportFileError, NOT_A_BACKUP } from '@/data/transfer';
import type { Game } from '@/data/types';
import { ActionRow } from './ActionRow';
import {
  createBackupFile,
  createSpreadsheetFile,
  formatDayWithYear,
  readBackupFile,
  readLastBackupSavedAt,
  rememberBackupSaved,
} from './backupFiles';
import { buildGamesCsv } from './gamesCsv';
import { RestoreSheet, type RestoreRequest } from './RestoreSheet';
import { saveFile, type SaveFileResult } from './saveFile';

const SAVE_FAILED = "Couldn't save the file. Try again.";
const UNREADABLE = "This file couldn't be opened. Try choosing it again.";

/**
 * Backup files: save one (share sheet or download), restore one, and export the
 * games as a spreadsheet.
 */
export function BackupSection({ games }: { games: readonly Game[] }) {
  const toast = useToast();
  // Everything, kept ready: the share sheet only opens straight from a tap, with no
  // waiting on the database in between.
  const snapshot = useLiveQuery(exportAll);
  const [lastSavedAt, setLastSavedAt] = useState(readLastBackupSavedAt);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoreRequest, setRestoreRequest] = useState<RestoreRequest | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const hasData = Boolean(snapshot && (snapshot.games.length > 0 || snapshot.players.length > 0));
  const hasFinalGames = games.some((game) => game.status === 'final');

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
    if (!snapshot || sharingRef.current) return;
    const now = new Date();
    const result = await share(createBackupFile(snapshot, now));
    if (result === 'shared' || result === 'downloaded') {
      rememberBackupSaved(now.getTime());
      setLastSavedAt(now.getTime());
      toast.show({ message: result === 'shared' ? 'Backup file saved' : 'Backup file downloaded' });
    } else if (result === 'failed') {
      toast.show({ message: SAVE_FAILED });
    }
  };

  const exportSpreadsheet = async () => {
    if (!snapshot || sharingRef.current) return;
    const now = new Date();
    const csv = buildGamesCsv(snapshot.games, snapshot.events);
    const result = await share(createSpreadsheetFile(csv, now));
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

  let saveSubtitle = 'Not saved on this phone yet';
  if (lastSavedAt !== undefined) saveSubtitle = `Last saved: ${formatDayWithYear(lastSavedAt)}`;
  if (snapshot && !hasData) saveSubtitle = 'Nothing to back up yet';

  return (
    <div>
      <GroupedList
        header="Backup"
        footer="Your stats are stored only on this phone. Save a backup file now and then (to Files, iCloud Drive or email) so you can always get them back."
      >
        <ActionRow
          title="Save a backup file"
          subtitle={saveSubtitle}
          onClick={saveBackup}
          disabled={!hasData || sharing}
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
          disabled={!snapshot || !hasFinalGames || sharing}
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
