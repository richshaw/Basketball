import { Fragment, useState } from 'react';
import { Button } from '@/components/Button/Button';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { Sheet } from '@/components/Sheet/Sheet';
import { useToast } from '@/components/Toast/toastContext';
import { importAll, type ExportFile, type ImportMode } from '@/data/transfer';
import { ActionRow } from './ActionRow';
import { backupSummary, restoredMessage } from './backupFiles';
import styles from './RestoreSheet.module.css';

/**
 * What the sheet shows: a backup ready to restore (with how many games the phone had
 * when it was picked, so the choices don't change as it restores), or why a file
 * can't be restored.
 */
export type RestoreRequest =
  | { kind: 'preview'; backup: ExportFile; phoneGameCount: number }
  | { kind: 'error'; message: string };

export interface RestoreSheetProps {
  open: boolean;
  /** Kept after closing, so the sheet keeps its content while it slides away. */
  request: RestoreRequest | null;
  onClose: () => void;
}

const RESTORE_FAILED = "Couldn't restore the backup. Nothing on this phone was changed.";

/** 'The game on this phone and its stats' or 'All 3 games on this phone and their stats'. */
function phoneGamesAndStats(count: number): string {
  return count === 1
    ? 'The game on this phone and its stats'
    : `All ${count} games on this phone and their stats`;
}

/**
 * Shows what a backup holds and restores it: added to this phone's data (merge,
 * recommended) or replacing it (after a confirmation). With no games on the phone
 * there's nothing to lose, so it just restores.
 */
export function RestoreSheet({ open, request, onClose }: RestoreSheetProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);

  if (!request) return null;

  if (request.kind === 'error') {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="Can't restore this file"
        description={request.message}
        hideCloseButton
        footer={
          <Button variant="secondary" size="lg" onClick={onClose}>
            OK
          </Button>
        }
      >
        <p className={styles.note}>
          Choose a backup saved from Hoop Stats. Its name starts with <em>hoop-stats-backup</em>.
        </p>
      </Sheet>
    );
  }

  const { backup, phoneGameCount } = request;

  const restore = async (mode: ImportMode) => {
    if (restoring) return;
    if (mode === 'replace' && phoneGameCount > 0) {
      const confirmed = await confirm({
        title: 'Replace everything on this phone?',
        message: `${phoneGamesAndStats(phoneGameCount)} will be erased and replaced with what's in the backup. This can't be undone.`,
        confirmLabel: 'Replace everything',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setRestoring(true);
    try {
      await importAll(backup, mode);
      onClose();
      toast.show({ message: restoredMessage(backup.games.length) });
    } catch (error) {
      console.error('Restoring a backup failed', error);
      toast.show({ message: RESTORE_FAILED });
    } finally {
      setRestoring(false);
    }
  };

  const phoneIsEmpty = phoneGameCount === 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Restore this backup?"
      description={backupSummary(backup).map((part, index) => (
        // Line breaks only between the parts, never inside "Sep 28, 2026".
        <Fragment key={index}>
          {index > 0 ? ' · ' : null}
          <span className={styles.noWrap}>{part}</span>
        </Fragment>
      ))}
      footer={
        phoneIsEmpty ? (
          <Button size="lg" onClick={() => void restore('replace')} disabled={restoring}>
            Restore backup
          </Button>
        ) : null
      }
    >
      {phoneIsEmpty ? (
        <p className={styles.note}>
          There are no games on this phone yet, so nothing will be lost.
        </p>
      ) : (
        <GroupedList aria-label="How to restore">
          <ActionRow
            title="Add to what's on this phone"
            subtitle={
              <>
                <strong className={styles.recommended}>Recommended.</strong> Keeps everything here
                and adds what&apos;s new. For a game on both, the newer version wins, stats and all.
              </>
            }
            onClick={() => void restore('merge')}
            disabled={restoring}
          />
          <ListRow
            title="Replace everything on this phone"
            subtitle={`Erases ${phoneGamesAndStats(phoneGameCount).toLowerCase()} first.`}
            destructive
            onClick={() => void restore('replace')}
            disabled={restoring}
          />
        </GroupedList>
      )}
    </Sheet>
  );
}
