import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/Button/Button';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { TextField } from '@/components/TextField/TextField';
import {
  enableCloudBackupWithCode,
  fetchCloudBackup,
  isCloudBackupAvailable,
  listCloudVersions,
  type BackupVersion,
  type CloudBackup,
  type CloudBackupErrorKind,
} from '@/data/backup/cloudBackup';
import { useGames } from '@/data/hooks';
import { paths } from '@/routes';
import { ActionRow } from './ActionRow';
import { cloudBackupSummary, codeFromTyped, formatBackupTime } from './cloudBackupText';
import { RestoreSheet, type RestoreRequest } from './RestoreSheet';
import { useBackupCode } from './useBackupCode';
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
  /** When `backup` is an older backup: the newest one's version, as listed (see `turnOnBackup`). */
  newestVersion?: string;
}

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
  const games = useGames();
  const phoneCode = useBackupCode();
  const available = isCloudBackupAvailable();
  const inputRef = useRef<HTMLInputElement>(null);

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

  const preview = (next: Found) => {
    setFound(next);
    setRequest({
      kind: 'preview',
      backup: next.backup.file,
      phoneGameCount: games?.length ?? 0,
      summary: cloudBackupSummary(next.backup),
    });
    setSheetOpen(true);
  };

  const find = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (finding || games === undefined) return;
    const code = codeFromTyped(value);
    const current = ++attempt.current;
    setFinding(true);
    setCodeError(undefined);
    setProblem(undefined);
    setOlderFor(null);
    setVersions(null);
    // A mistyped code is caught here, before anything is sent.
    const result = await fetchCloudBackup(code);
    if (current !== attempt.current) return;
    setFinding(false);
    if (result.ok) {
      setOlderFor(code);
      preview({ code, backup: result.value });
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
    setLoading('list');
    setProblem(undefined);
    const result = await listCloudVersions(olderFor);
    setLoading(null);
    if (result.ok) setVersions(result.value);
    else setProblem(result.error.message);
  };

  const openVersion = async (version: BackupVersion) => {
    if (!olderFor || loading) return;
    setLoading(version.version);
    setProblem(undefined);
    const result = await fetchCloudBackup(olderFor, { version: version.version });
    setLoading(null);
    if (!result.ok) {
      setProblem(result.error.message);
      return;
    }
    const newest = versions?.[0]?.version;
    preview({
      code: olderFor,
      backup: result.value,
      newestVersion: newest === version.version ? undefined : newest,
    });
  };

  /** After the import: this phone carries on backing up with the code. Never rejects. */
  const turnOnBackup = async (): Promise<string | undefined> => {
    if (!found) return undefined;
    // The engine carries on from the server's newest version, so an older backup isn't
    // taken for another phone's later. If it can't ask the server just then, it falls
    // back to the backup's own version: give it the newest this screen listed instead.
    const backup = found.newestVersion
      ? { ...found.backup, version: found.newestVersion }
      : found.backup;
    try {
      const result = await enableCloudBackupWithCode(found.code, { backup });
      return result.ok
        ? 'This phone now backs up with this code.'
        : `Cloud backup couldn't be turned on. ${result.error.message}`;
    } catch (error) {
      console.error('Turning on cloud backup after a restore failed', error);
      return "Cloud backup couldn't be turned on. Try restoring again.";
    }
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
                <Button type="submit" size="lg" block disabled={finding || games === undefined}>
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
        onRestored={() => void navigate(paths.home, { replace: true })}
      />
    </main>
  );
}
