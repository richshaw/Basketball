import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button/Button';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { Sheet } from '@/components/Sheet/Sheet';
import { useToast } from '@/components/Toast/toastContext';
import { disableCloudBackup } from '@/data/backup/cloudBackup';
import { ActionRow } from './ActionRow';
import { deleteOnlineBackupQuestion } from './cloudBackupText';
import { useStillHere } from './useStillHere';
import styles from './TurnOffSheet.module.css';

export interface TurnOffSheetProps {
  open: boolean;
  onClose: () => void;
  /** Backup is off (`deleted`: and the online backup is gone). Close the sheet and say so. */
  onTurnedOff: (deleted: boolean) => void;
  /**
   * What the online backup has that this phone doesn't (see onlyOnline), while paused
   * for missing games: deleting it would lose them for good, so both choices say so.
   */
  onlyOnlineGames?: string;
}

/** The engine's reasons run to two sentences: long enough to read them. */
const MESSAGE_TOAST_MS = 6000;

/**
 * Turning cloud backup off, two ways: keep the online backup (and the code, so turning
 * backup on again carries on with it), or delete it too, which asks first and needs
 * signal. If the delete fails, backup stays on and the sheet says why. Mount it with a
 * new `key` each time it opens, so it starts without the last problem.
 */
export function TurnOffSheet({ open, onClose, onTurnedOff, onlyOnlineGames }: TurnOffSheetProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [working, setWorking] = useState<'off' | 'delete' | null>(null);
  const [problem, setProblem] = useState<string | undefined>();
  // Whether the sheet is still open (or there at all) when an answer arrives: it can be
  // closed meanwhile, or Settings left for the live game.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const stillHere = useStillHere();

  const turnOff = async (deleteCloudCopy: boolean) => {
    if (working) return;
    if (deleteCloudCopy) {
      if (!(await confirm(deleteOnlineBackupQuestion(onlyOnlineGames)))) return;
    }
    setWorking(deleteCloudCopy ? 'delete' : 'off');
    setProblem(undefined);
    try {
      const result = await disableCloudBackup({ deleteCloudCopy });
      if (!stillHere()) return;
      if (result.ok) onTurnedOff(deleteCloudCopy);
      else if (openRef.current) setProblem(result.error.message);
      else toast.show({ message: result.error.message, duration: MESSAGE_TOAST_MS });
    } finally {
      setWorking(null);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Turn off cloud backup?"
      description="Your stats stay on this phone either way."
      hideCloseButton
      footer={
        <Button variant="secondary" size="lg" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <GroupedList aria-label="How to turn off">
        <ActionRow
          title="Turn off"
          subtitle="Keeps your online backup. This phone keeps its backup code, so turning backup on again carries on with it."
          onClick={() => void turnOff(false)}
          disabled={working !== null}
        />
        <ListRow
          title={
            working === 'delete' ? 'Deleting online backup…' : 'Turn off and delete online backup'
          }
          subtitle={
            onlyOnlineGames
              ? `${onlyOnlineGames}: deleting the online backup loses them for good. Needs an internet connection.`
              : 'Deletes every backup saved with this code, so nobody can restore from it. Needs an internet connection.'
          }
          destructive
          onClick={() => void turnOff(true)}
          disabled={working !== null}
        />
      </GroupedList>
      {/* Always there (empty until needed), so screen readers announce what appears. */}
      <div role="alert" className={styles.problem}>
        {problem ? <p>{problem}</p> : null}
      </div>
    </Sheet>
  );
}
