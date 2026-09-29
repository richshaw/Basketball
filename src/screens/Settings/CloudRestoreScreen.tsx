import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/Button/Button';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { TextField } from '@/components/TextField/TextField';
import { useToast } from '@/components/Toast/toastContext';
import {
  enableCloudBackupWithCode,
  fetchCloudBackup,
  getCloudBackupStatus,
  isCloudBackupAvailable,
  listCloudVersions,
  type BackupVersion,
  type CloudBackup,
  type CloudBackupErrorKind,
  type CloudResult,
} from '@/data/backup/cloudBackup';
import { normalizeBackupCode } from '@/data/backup/code';
import { useGames } from '@/data/hooks';
import { paths } from '@/routes';
import { ActionRow } from './ActionRow';
import { cloudBackupSummary, codeFromTyped, formatBackupTime } from './cloudBackupText';
import { RestoreCodeNote } from './RestoreCodeNote';
import { RestoreSheet, type RestoreRequest } from './RestoreSheet';
import { useBackupCode } from './useBackupCode';
import { useStillHere } from './useStillHere';
import styles from './CloudRestoreScreen.module.css';

/** Failures that mean the code itself is wrong (or has nothing saved): shown on the field. */
const CODE_PROBLEMS: ReadonlySet<CloudBackupErrorKind> = new Set([
  'invalid-code',
  'unauthorized',
  'not-found',
]);

/** The code has backups, but the newest can't be restored: an older one may help. */
const BACKUP_PROBLEMS: ReadonlySet<CloudBackupErrorKind> = new Set([
  'damaged',
  'newer-version',
  'unsupported',
]);

/** A backup found by its code, being previewed and maybe restored. */
interface Found {
  code: string;
  backup: CloudBackup;
  /** This phone's own code, when restoring switches it to `code` (see RestoreCodeNote). */
  switchingFrom?: string;
  /** This phone backs up with `code` already: restoring changes nothing about that. */
  alreadyBackingUp?: boolean;
  /**
   * The server's newest version as this screen saw it: `backup`'s own, or the first of
   * the older backups' list. Turning backup on with it needs no request (see
   * enableCloudBackupWithCode).
   */
  newestVersion?: string;
}

const NOW_BACKS_UP = 'This phone now backs up with this code.';
const KEEPS_BACKING_UP = 'This phone keeps backing up with this code.';

/** Whether cloud backup is on now (false if that can't be read). */
function isBackupOn(): Promise<boolean> {
  return getCloudBackupStatus().then(
    (status) => status.enabled,
    () => false,
  );
}

/** Whether two typed or stored codes are the same code (however they're written). */
function sameCode(a: string, b: string): boolean {
  try {
    return normalizeBackupCode(a) === normalizeBackupCode(b);
  } catch {
    return false;
  }
}
/** Long enough to read the engine's reason. */
const MESSAGE_TOAST_MS = 6000;

/**
 * Restore from a backup code (full screen): on a new phone, after "Erase all data", or
 * when backup paused because games are missing here. The parent types the code (this
 * phone's own is filled in when it has one), sees what the newest backup holds (or
 * picks an older one), and restores it with the same choices as a backup file. Then
 * this phone carries on backing up with that code, and Games shows the games.
 * `?from=games` (paths.restoreBackup('games')) makes the back link return to Games.
 */
export function CloudRestoreScreen() {
  const [searchParams] = useSearchParams();
  const fromGames = searchParams.get('from') === 'games';
  const navigate = useNavigate();
  const toast = useToast();
  const games = useGames();
  const phoneCode = useBackupCode();
  const available = isCloudBackupAvailable();
  const inputRef = useRef<HTMLInputElement>(null);
  // Nothing happens here once the parent has left the screen (for the live game, say),
  // even just a moment before: see useStillHere.
  const stillHere = useStillHere();
  // Turning backup on after the last restore, which Games waits for (see `restored`).
  const turningOn = useRef<Promise<CloudResult<void>> | null>(null);

  // What's in the field: this phone's own code, until the parent types.
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? phoneCode ?? '';
  const prefilled = typed === null && Boolean(phoneCode);

  const [codeError, setCodeError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [finding, setFinding] = useState(false);
  // Bumped by each search and each edit, so an answer for an older code is ignored.
  const attempt = useRef(0);
  // The code whose older backups can be listed (the server has backups for it).
  const [olderFor, setOlderFor] = useState<string | null>(null);
  const [versions, setVersions] = useState<BackupVersion[] | null>(null);
  // 'list' while listing the older backups, or the version being opened.
  const [loading, setLoading] = useState<string | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [request, setRequest] = useState<RestoreRequest | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const edit = (text: string) => {
    attempt.current += 1;
    setTyped(text);
    setFinding(false);
    setCodeError(undefined);
    setProblem(undefined);
    setOlderFor(null);
    setVersions(null);
  };

  /** Opens the restore sheet for a backup found; `backupOn`: cloud backup was on as it was found. */
  const preview = (next: Found, backupOn: boolean) => {
    // Checked as the sheet opens, so what it says stays put while it slides away.
    if (phoneCode && !sameCode(next.code, phoneCode)) next.switchingFrom = phoneCode;
    else if (phoneCode && backupOn) next.alreadyBackingUp = true;
    setFound(next);
    setRequest({
      kind: 'preview',
      backup: next.backup.file,
      phoneGameIds: games?.map((game) => game.id) ?? [],
      summary: cloudBackupSummary(next.backup),
    });
    setSheetOpen(true);
  };

  const find = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (finding || games === undefined || phoneCode === undefined) return;
    const code = codeFromTyped(value);
    const current = ++attempt.current;
    setFinding(true);
    setCodeError(undefined);
    setProblem(undefined);
    setOlderFor(null);
    setVersions(null);
    // A mistyped code is caught here, before anything is sent.
    const [result, backupOn] = await Promise.all([fetchCloudBackup(code), isBackupOn()]);
    if (current !== attempt.current) return;
    setFinding(false);
    if (result.ok) {
      setOlderFor(code);
      preview({ code, backup: result.value, newestVersion: result.value.version }, backupOn);
      return;
    }
    const { kind, message } = result.error;
    if (CODE_PROBLEMS.has(kind)) {
      setCodeError(message);
      inputRef.current?.focus();
    } else {
      setProblem(message);
      if (BACKUP_PROBLEMS.has(kind)) setOlderFor(code);
    }
  };

  const listOlder = async () => {
    if (!olderFor || loading) return;
    const current = attempt.current;
    setLoading('list');
    setProblem(undefined);
    const result = await listCloudVersions(olderFor);
    setLoading(null);
    // The code was changed meanwhile: these are some other code's backups.
    if (current !== attempt.current) return;
    if (result.ok) setVersions(result.value);
    else setProblem(result.error.message);
  };

  const openVersion = async (version: BackupVersion) => {
    if (!olderFor || loading) return;
    const current = attempt.current;
    setLoading(version.version);
    setProblem(undefined);
    const [result, backupOn] = await Promise.all([
      fetchCloudBackup(olderFor, { version: version.version }),
      isBackupOn(),
    ]);
    setLoading(null);
    if (current !== attempt.current) return;
    if (!result.ok) {
      setProblem(result.error.message);
      return;
    }
    preview(
      {
        code: olderFor,
        backup: result.value,
        newestVersion: versions?.[0]?.version ?? result.value.version,
      },
      backupOn,
    );
  };

  /**
   * Right after the import: this phone carries on backing up with the code. It needs no
   * signal (the newest version is known), and nothing waits for it but going to Games.
   * If it fails while the parent is still here, she's told instead of what the sheet
   * said, which closes if it stayed open (after an Add that found nothing new).
   */
  const turnOnBackup = (): string | undefined => {
    if (!found) return undefined;
    const { code, backup, newestVersion, alreadyBackingUp } = found;
    const turning = enableCloudBackupWithCode(code, { backup, newestVersion }).catch(
      (error: unknown): CloudResult<void> => {
        console.error('Turning on cloud backup after a restore failed', error);
        return { ok: false, error: { kind: 'unexpected', message: 'Try restoring again.' } };
      },
    );
    turningOn.current = turning;
    void turning.then((result) => {
      if (result.ok || !stillHere()) return;
      setSheetOpen(false);
      toast.show({
        message: `Cloud backup couldn't be turned on. ${result.error.message}`,
        duration: MESSAGE_TOAST_MS,
      });
    });
    return alreadyBackingUp ? KEEPS_BACKING_UP : NOW_BACKS_UP;
  };

  /** The restore is done and its sheet closed: on to Games, if the parent is still here. */
  const restored = async () => {
    await turningOn.current;
    if (stillHere()) void navigate(paths.home, { replace: true });
  };

  const olderBackups = versions?.slice(1) ?? [];

  return (
    <main>
      <ScreenHeader
        title="Restore from backup"
        backTo={fromGames ? paths.home : paths.settings}
        backLabel={fromGames ? 'Games' : 'Settings'}
      />
      <ScreenBody className={styles.body}>
        {available ? (
          <>
            <p className={styles.intro}>
              Enter the backup code you saved when you turned on cloud backup.
            </p>
            <div>
              <form className={styles.form} noValidate onSubmit={find}>
                <TextField
                  ref={inputRef}
                  label="Backup code"
                  hint={
                    prefilled
                      ? "This phone's backup code is filled in."
                      : "28 letters and numbers. Capitals, spaces and dashes don't matter."
                  }
                  error={codeError}
                  value={value}
                  onChange={(event) => edit(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  enterKeyHint="go"
                  className={styles.codeField}
                />
                <Button
                  type="submit"
                  size="lg"
                  block
                  disabled={finding || games === undefined || phoneCode === undefined}
                >
                  {finding ? 'Finding backup…' : 'Find backup'}
                </Button>
              </form>
              {/* Always there (empty until needed), so screen readers announce what appears. */}
              <div role="alert" className={styles.problem}>
                {problem ? <p>{problem}</p> : null}
              </div>
            </div>
            {olderFor ? (
              <GroupedList
                header="Older backups"
                footer={
                  versions && olderBackups.length === 0
                    ? 'There are no older backups for this code.'
                    : 'If the newest backup looks wrong, restore an earlier one instead.'
                }
              >
                {versions === null ? (
                  <ActionRow
                    title={loading === 'list' ? 'Finding older backups…' : 'Show older backups'}
                    onClick={() => void listOlder()}
                    disabled={loading !== null}
                  />
                ) : (
                  olderBackups.map((version) => (
                    <ListRow
                      key={version.version}
                      title={
                        <span className="tabular-nums">{formatBackupTime(version.createdAt)}</span>
                      }
                      value={loading === version.version ? 'Opening…' : undefined}
                      chevron
                      onClick={() => void openVersion(version)}
                      disabled={loading !== null}
                    />
                  ))
                )}
              </GroupedList>
            ) : null}
            <p className={styles.note}>
              Have a backup file instead?{' '}
              <Link to={paths.settings} className={styles.noteLink}>
                Restore it in Settings
              </Link>
            </p>
          </>
        ) : (
          <p className={styles.intro}>
            Cloud backup isn't available in this version of Hoop Stats.{' '}
            <Link to={paths.settings} className={styles.noteLink}>
              Restore a backup file in Settings
            </Link>
          </p>
        )}
      </ScreenBody>
      <RestoreSheet
        open={sheetOpen}
        request={request}
        onClose={() => setSheetOpen(false)}
        afterRestore={turnOnBackup}
        onRestored={() => void restored()}
        replaceNote={
          found?.switchingFrom
            ? 'This phone will also switch to the backup code you entered.'
            : undefined
        }
      >
        <RestoreCodeNote switchingFrom={found?.switchingFrom} />
      </RestoreSheet>
    </main>
  );
}
