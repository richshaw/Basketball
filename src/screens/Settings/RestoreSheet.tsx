import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button/Button';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { Sheet } from '@/components/Sheet/Sheet';
import { useToast } from '@/components/Toast/toastContext';
import {
  importAll,
  sampleGamesToRemove,
  type ExportFile,
  type ImportMode,
  type ImportSummary,
} from '@/data/transfer';
import { cx } from '@/lib/cx';
import { ActionRow } from './ActionRow';
import {
  backupSummary,
  nothingNewMessage,
  restoredMessage,
  sampleGamesRemovedNote,
} from './backupFiles';
import { useStillHere } from './useStillHere';
import styles from './RestoreSheet.module.css';

/**
 * What the sheet shows: a backup ready to restore (with the games the phone had when it
 * was picked, by id, so the choices don't change as it restores, and optionally what to
 * say it holds instead of `backupSummary`), or why a file can't be restored
 * (`notABackup`: the wrong file was picked, so say which to pick).
 */
export type RestoreRequest =
  | {
      kind: 'preview';
      backup: ExportFile;
      phoneGameIds: readonly string[];
      summary?: readonly string[];
    }
  | { kind: 'error'; message: string; notABackup: boolean };

export interface RestoreSheetProps {
  open: boolean;
  /** Kept after closing, so the sheet keeps its content while it slides away. */
  request: RestoreRequest | null;
  onClose: () => void;
  /**
   * Called as soon as the backup is on the phone, before the sheet closes and says so
   * (e.g. to turn cloud backup on with the backup's code, in the background). Returns a
   * sentence to add to what the sheet says, at once: nothing waits for it. If it throws,
   * the restore still stands and the sheet says only what was restored.
   */
  afterRestore?: () => string | undefined;
  /**
   * A restore finished and closed the sheet (e.g. to leave the screen). Not called if
   * the parent closed the sheet herself while it was restoring.
   */
  onRestored?: () => void;
  /** Said above the choices, before anything is restored (e.g. which backup code is used). */
  children?: ReactNode;
  /** Added to the "Replace everything" question (e.g. that the phone switches codes). */
  replaceNote?: string;
}

const RESTORE_FAILED = "Couldn't restore the backup. Nothing on this phone was changed.";
/** A toast with a second sentence (see `afterRestore`) stays long enough to read. */
const NOTE_TOAST_MS = 6000;

/** 'The game on this phone and its stats' or 'All 3 games on this phone and their stats'. */
function phoneGamesAndStats(count: number): string {
  return count === 1
    ? 'The game on this phone and its stats'
    : `All ${count} games on this phone and their stats`;
}

/** 'a and b', or 'a, b, and c'. */
function listInWords(items: readonly string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

/**
 * The Replace confirmation: everything it erases. That's the player and the settings
 * too, not just the games (a backup without settings leaves this phone's alone).
 */
function replaceWarning(phoneGameCount: number, backup: ExportFile): string {
  const erased = [phoneGamesAndStats(phoneGameCount), "the player's name and number"];
  if (backup.settings) erased.push('your settings');
  return `${listInWords(erased)} will be erased and replaced with what's in the backup. This can't be undone.`;
}

/** The Replace row's subtitle, e.g. 'Erases everything on this phone first: all 3 games, the player and your settings.' */
function replaceSubtitle(phoneGameCount: number, backup: ExportFile): string {
  const games = phoneGameCount === 1 ? 'its game' : `all ${phoneGameCount} games`;
  const rest = backup.settings ? ', the player and your settings' : ' and the player';
  return `Erases everything on this phone first: ${games}${rest}.`;
}

/**
 * Shows what a backup holds and restores it: added to this phone's data (merge,
 * recommended) or replacing it (after a confirmation). With no games on the phone
 * it just adds the backup: a merge, so the player's name and the settings set up
 * here are kept (Replace would erase them too). A backup with games of her own removes
 * the sample games from the phone (see sampleGamesToRemove), and the sheet says so
 * before anything is picked; a phone with only those is as good as empty.
 */
export function RestoreSheet({
  open,
  request,
  onClose,
  afterRestore,
  onRestored,
  children,
  replaceNote,
}: RestoreSheetProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);
  // The request whose "Add" found nothing new: a new file starts without the note.
  const [nothingNew, setNothingNew] = useState<{ request: RestoreRequest; note?: string } | null>(
    null,
  );
  // A restore that finishes after the sheet (or its screen) has gone says nothing: the
  // parent may be on the live game screen by then.
  const stillHere = useStillHere();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

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
        {request.notABackup ? (
          <p className={styles.note}>
            Choose a backup saved from Hoop Stats. Its name starts with <em>hoop-stats-backup</em>.
          </p>
        ) : null}
      </Sheet>
    );
  }

  const { backup, phoneGameIds } = request;
  const phoneGameCount = phoneGameIds.length;
  // The sample games adding this backup removes: the backup has games of her own.
  const samplesRemoved = sampleGamesToRemove(phoneGameIds, backup).length;
  // Nothing on the phone would be left to lose (sample games aside): just add it.
  const phoneIsEmpty = phoneGameCount === samplesRemoved;

  const restore = async (mode: ImportMode) => {
    if (restoring) return;
    if (mode === 'replace') {
      const confirmed = await confirm({
        title: 'Replace everything on this phone?',
        message: replaceNote
          ? `${replaceWarning(phoneGameCount, backup)} ${replaceNote}`
          : replaceWarning(phoneGameCount, backup),
        confirmLabel: 'Replace everything',
        destructive: true,
      });
      if (!confirmed) return;
    }
    setRestoring(true);
    let taken: ImportSummary;
    try {
      taken = await importAll(backup, mode);
    } catch (error) {
      console.error('Restoring a backup failed', error);
      setRestoring(false);
      if (stillHere()) toast.show({ message: RESTORE_FAILED });
      return;
    }
    let note: string | undefined;
    try {
      note = afterRestore?.();
    } catch (error) {
      // The backup is on the phone either way: say so, without the extra sentence.
      console.error('After restoring a backup', error);
    }
    setRestoring(false);
    if (!stillHere()) return;
    const nothingChanged = taken.games === 0 && !taken.sampleGamesRemoved;
    if (mode === 'merge' && nothingChanged && backup.games.length > 0 && !phoneIsEmpty) {
      // Nothing to add: say so next to Replace, the way to get the backup's versions.
      setNothingNew({ request, note });
      return;
    }
    const closedMeanwhile = !openRef.current;
    onClose();
    const restored = restoredMessage(taken, backup.games.length);
    toast.show(
      note ? { message: `${restored}. ${note}`, duration: NOTE_TOAST_MS } : { message: restored },
    );
    if (!closedMeanwhile) onRestored?.();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Restore this backup?"
      description={(request.summary ?? backupSummary(backup)).map((part, index, parts) => (
        // A part moves to the next line whole (never "Sep 28," then "2026"), with the dot
        // after it; only a part longer than a whole line wraps inside.
        <Fragment key={index}>
          {index > 0 ? ' ' : null}
          <span className={styles.part}>
            {part}
            {index < parts.length - 1 ? ' ·' : null}
          </span>
        </Fragment>
      ))}
      footer={
        phoneIsEmpty ? (
          <Button size="lg" onClick={() => void restore('merge')} disabled={restoring}>
            Restore backup
          </Button>
        ) : null
      }
    >
      {children ? <div className={styles.before}>{children}</div> : null}
      {phoneIsEmpty ? (
        <p className={styles.note}>
          {samplesRemoved > 0
            ? `${sampleGamesRemovedNote(samplesRemoved)} Nothing else will be lost.`
            : 'There are no games on this phone yet, so nothing will be lost.'}
        </p>
      ) : (
        <>
          {samplesRemoved > 0 ? (
            <p className={cx(styles.note, styles.before)}>
              {sampleGamesRemovedNote(samplesRemoved)}
            </p>
          ) : null}
          <GroupedList aria-label="How to restore">
            <ActionRow
              title="Add to what's on this phone"
              subtitle={
                <>
                  <strong className={styles.recommended}>Recommended.</strong>{' '}
                  {samplesRemoved > 0 ? 'Keeps your games here' : 'Keeps everything here'} and adds
                  what&apos;s missing, even games deleted here. For a game on both, the newer
                  version wins, stats and all.
                </>
              }
              onClick={() => void restore('merge')}
              disabled={restoring}
            />
            <ListRow
              title="Replace everything on this phone"
              subtitle={replaceSubtitle(phoneGameCount, backup)}
              destructive
              onClick={() => void restore('replace')}
              disabled={restoring}
            />
          </GroupedList>
          {/* Always there (empty until needed), so screen readers announce what appears. */}
          <div role="status" aria-label="Restore result">
            {nothingNew?.request === request ? (
              <p className={cx(styles.note, styles.result)}>
                {nothingNewMessage(backup.games.length)}
                {nothingNew.note ? ` ${nothingNew.note}` : null}
              </p>
            ) : null}
          </div>
        </>
      )}
    </Sheet>
  );
}
