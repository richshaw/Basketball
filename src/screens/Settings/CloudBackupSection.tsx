import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { AlertIcon, CloudCheckIcon, CloudIcon, CloudOffIcon } from '@/components/Icons/Icons';
import { useToast, type ToastOptions } from '@/components/Toast/toastContext';
import {
  backUpNow,
  disableCloudBackup,
  enableCloudBackup,
  getBackupCode,
  type CloudBackupStatus,
} from '@/data/backup/cloudBackup';
import { cx } from '@/lib/cx';
import { paths } from '@/routes';
import { ActionRow } from './ActionRow';
import { BackupCodeSheet, type BackupCodeReason } from './BackupCodeSheet';
import {
  backUpAnywayMessage,
  deleteOnlineBackupQuestion,
  describeStatus,
  onlyOnline,
  USE_THIS_PHONE_MESSAGE,
  type StatusTone,
} from './cloudBackupText';
import { TurnOffSheet } from './TurnOffSheet';
import { useNow } from './useNow';
import { useOnline } from './useOnline';
import { useStillHere } from './useStillHere';
import styles from './CloudBackupSection.module.css';

/** The engine's messages can run to two sentences: give them time to be read. */
const MESSAGE_TOAST_MS = 6000;

const OFF_FOOTER =
  "Keeps an encrypted copy of your stats online whenever there's signal, so a lost or broken phone doesn't mean lost stats. Only someone with your backup code can read it.";
const ON_FOOTER =
  "Backs up an encrypted copy of your stats whenever there's signal. Only someone with your backup code can read it.";

export interface CloudBackupSectionProps {
  status: CloudBackupStatus;
  /** This phone's backup code (while on, or kept after turning off), or null. */
  code: string | null;
  /**
   * Each new value scrolls here and takes focus: Settings opened at this section (a tap
   * on the backup banner, every time, even on the same address).
   */
  focusRequest?: string;
}

function StatusIcon({ tone }: { tone: StatusTone }) {
  switch (tone) {
    case 'ok':
      return <CloudCheckIcon className={cx(styles.statusIcon, styles.ok)} />;
    case 'busy':
      return <span className={styles.spinner} />;
    case 'waiting':
      return <CloudIcon className={styles.statusIcon} />;
    case 'offline':
      return <CloudOffIcon className={styles.statusIcon} />;
    case 'attention':
      return <AlertIcon className={cx(styles.statusIcon, styles.attention)} />;
  }
}

/**
 * The status row: what cloud backup is doing, in plain words ("Backed up 2 minutes
 * ago"), and why it paused or stopped. The times stay fresh while Settings is open,
 * and so does whether the phone has signal (or just can't reach the backup server).
 */
function StatusRow({ status }: { status: CloudBackupStatus }) {
  const now = useNow();
  const online = useOnline();
  // A backup that finished since the last tick is "just now", never in the future.
  const line = describeStatus(status, Math.max(now, status.lastSuccessAt ?? 0), { online });
  return (
    <ListRow
      className={styles.statusRow}
      icon={<StatusIcon tone={line.tone} />}
      title={<span className={styles.statusTitle}>{line.title}</span>}
      subtitle={line.detail}
    />
  );
}

/**
 * Settings > Cloud backup: turning the encrypted cloud backup on (and showing its code
 * to save), its status, "Back up now", the code again, turning it off, and what to do
 * when it pauses. SettingsScreen shows it only in builds with a backup server.
 */
export function CloudBackupSection({ status, code, focusRequest }: CloudBackupSectionProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [codeSheet, setCodeSheet] = useState<{ code: string; reason: BackupCodeReason } | null>(
    null,
  );
  const [codeSheetOpen, setCodeSheetOpen] = useState(false);
  const [turnOffOpen, setTurnOffOpen] = useState(false);
  // A fresh turn-off sheet each time, without the last one's problem.
  const [turnOffKey, setTurnOffKey] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const { state } = status;
  // An answer that comes after the parent left Settings (for the live game, say) isn't
  // shown: the status row says how it went next time she looks.
  const stillHere = useStillHere();
  const say = (options: ToastOptions) => {
    if (stillHere()) toast.show(options);
  };

  useEffect(() => {
    const section = sectionRef.current;
    if (focusRequest === undefined || !section) return;
    section.focus({ preventScroll: true });
    if (typeof section.scrollIntoView === 'function') section.scrollIntoView({ block: 'center' });
  }, [focusRequest]);

  /** Runs one action at a time; the rows are disabled meanwhile. */
  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await task();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const showCode = (value: string, reason: BackupCodeReason) => {
    setCodeSheet({ code: value, reason });
    setCodeSheetOpen(true);
  };

  const turnOn = () =>
    run(async () => {
      try {
        const newCode = await enableCloudBackup();
        showCode(newCode, newCode === code ? 'reused' : 'new');
      } catch (error) {
        console.error('Turning on cloud backup failed', error);
        say({ message: "Couldn't turn on cloud backup. Try again." });
      }
    });

  const backUp = (force: boolean) =>
    run(async () => {
      const result = await backUpNow({ force });
      say(
        result.ok
          ? { message: 'Backed up' }
          : { message: result.error.message, duration: MESSAGE_TOAST_MS },
      );
    });

  const askThenBackUp = async (title: string, message: string, confirmLabel: string) => {
    if (busyRef.current) return;
    const confirmed = await confirm({ title, message, confirmLabel, destructive: true });
    if (confirmed) await backUp(true);
  };

  const turnOffOnThisPhone = async () => {
    if (busyRef.current) return;
    const confirmed = await confirm({
      title: 'Turn off cloud backup on this phone?',
      message: 'The online backup stays, and the other phone can keep backing up with this code.',
      confirmLabel: 'Turn off',
    });
    if (!confirmed) return;
    await run(async () => {
      const result = await disableCloudBackup();
      say(
        result.ok
          ? { message: 'Cloud backup is off on this phone' }
          : { message: result.error.message, duration: MESSAGE_TOAST_MS },
      );
    });
  };

  // Off, with the code kept: the online backup can still be deleted.
  const deleteOnlineBackup = async () => {
    if (busyRef.current) return;
    if (!(await confirm(deleteOnlineBackupQuestion()))) return;
    await run(async () => {
      const result = await disableCloudBackup({ deleteCloudCopy: true });
      say(
        result.ok
          ? { message: 'Online backup deleted' }
          : { message: result.error.message, duration: MESSAGE_TOAST_MS },
      );
    });
  };

  const showSavedCode = async () => {
    const value = code ?? (await getBackupCode());
    if (value) showCode(value, 'show');
  };

  // Not while an upload she asked for runs: "Back up anyway" may be replacing the backup.
  const openRestore = () => void navigate(paths.restoreBackup());

  const openTurnOff = () => {
    setTurnOffKey((key) => key + 1);
    setTurnOffOpen(true);
  };

  const turnedOff = (deleted: boolean) => {
    setTurnOffOpen(false);
    say({
      message: deleted
        ? 'Cloud backup is off, and the online backup is deleted'
        : 'Cloud backup is off',
    });
  };

  let rows;
  if (!status.enabled) {
    rows = (
      <>
        <ActionRow
          title="Turn on cloud backup"
          subtitle={code ? 'Uses the same backup code as before.' : undefined}
          onClick={turnOn}
          disabled={busy}
        />
        <ListRow title="Restore from a backup code" chevron onClick={openRestore} disabled={busy} />
        {code ? (
          <ListRow
            title="Delete online backup"
            subtitle="Deletes every backup saved with this phone's code. Needs an internet connection."
            destructive
            onClick={() => void deleteOnlineBackup()}
            disabled={busy}
          />
        ) : null}
      </>
    );
  } else {
    let actions;
    if (state === 'paused-shrink') {
      actions = (
        <>
          <ListRow
            title="Restore from backup"
            subtitle="Brings the missing games back from your online backup."
            chevron
            onClick={openRestore}
            disabled={busy}
          />
          <ListRow
            title="Back up anyway"
            subtitle="Replaces your online backup with what's on this phone."
            destructive
            onClick={() =>
              void askThenBackUp(
                'Back up anyway?',
                backUpAnywayMessage(status.shrink),
                'Back up anyway',
              )
            }
            disabled={busy}
          />
        </>
      );
    } else if (state === 'paused-other-device') {
      actions = (
        <>
          <ListRow
            title="Restore from backup"
            subtitle="Gets the other phone's latest backup onto this phone, then carries on backing up."
            chevron
            onClick={openRestore}
            disabled={busy}
          />
          <ListRow
            title="Use this phone for backups"
            subtitle="Replaces the other phone's latest backup with this phone's stats."
            destructive
            onClick={() =>
              void askThenBackUp(
                'Use this phone for backups?',
                USE_THIS_PHONE_MESSAGE,
                'Use this phone',
              )
            }
            disabled={busy}
          />
        </>
      );
    } else {
      actions = (
        <>
          <ActionRow
            title="Back up now"
            onClick={() => void backUp(false)}
            disabled={busy || state === 'backing-up'}
          />
          <ListRow
            title="Restore from backup"
            subtitle="Brings back games from your online backup, or from an older one."
            chevron
            onClick={openRestore}
            disabled={busy}
          />
        </>
      );
    }
    rows = (
      <>
        <StatusRow status={status} />
        {actions}
        <ListRow title="Show backup code" chevron onClick={() => void showSavedCode()} />
        {state === 'paused-other-device' ? (
          <ListRow
            title="Turn off on this phone"
            onClick={() => void turnOffOnThisPhone()}
            disabled={busy}
          />
        ) : (
          <ListRow title="Turn off" onClick={openTurnOff} disabled={busy} />
        )}
      </>
    );
  }

  return (
    <section ref={sectionRef} tabIndex={-1} aria-label="Cloud backup" className={styles.section}>
      <GroupedList header="Cloud backup" footer={status.enabled ? ON_FOOTER : OFF_FOOTER}>
        {rows}
      </GroupedList>
      {codeSheet ? (
        <BackupCodeSheet
          open={codeSheetOpen}
          code={codeSheet.code}
          reason={codeSheet.reason}
          onClose={() => setCodeSheetOpen(false)}
        />
      ) : null}
      <TurnOffSheet
        key={turnOffKey}
        open={turnOffOpen}
        onClose={() => setTurnOffOpen(false)}
        onTurnedOff={turnedOff}
        onlyOnlineGames={state === 'paused-shrink' ? onlyOnline(status.shrink) : undefined}
      />
    </section>
  );
}
