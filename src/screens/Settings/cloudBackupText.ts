/**
 * What the cloud backup screens say, in plain words: the status line, times ("2 minutes
 * ago", "at 7:45 PM"), why backup paused, and what a backup found by its code holds.
 * Pure: the current time is passed in, so every sentence can be tested exactly.
 */
import type { CloudBackup, CloudBackupStatus } from '@/data/backup/cloudBackup';
import { countGames, describePlayer, formatDayWithYear } from './backupFiles';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A space a line never breaks at: keeps "Sep 28, 2026" and "7:45 PM" whole. */
const NO_BREAK = '\u00a0';

function unbreakable(text: string): string {
  return text.replace(/\s/g, NO_BREAK);
}

/** 'Sep 25', or 'Sep 25, 2025' when it isn't the year of `now` (never split across lines). */
function formatDay(time: number, now: number): string {
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return unbreakable(
    new Date(time).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    }),
  );
}

/** '7:45 PM' in local time (never split across lines). */
export function formatTimeOfDay(time: number): string {
  return unbreakable(
    new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  );
}

/**
 * How long ago: 'just now', 'a minute ago', '5 minutes ago', 'an hour ago', '3 hours
 * ago', then the day ('on Sep 25'). A time after `now` (a clock that moved) is 'just now'.
 */
export function timeAgo(time: number, now: number): string {
  const elapsed = now - time;
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  }
  return `on ${formatDay(time, now)}`;
}

/** When something will happen: 'at 7:45 PM' today, else 'on Sep 29 at 7:45 AM'. */
export function formatWhen(time: number, now: number): string {
  const sameDay = new Date(time).toDateString() === new Date(now).toDateString();
  const clock = `at ${formatTimeOfDay(time)}`;
  return sameDay ? clock : `on ${formatDay(time, now)} ${clock}`;
}

/**
 * A backup's date and time, e.g. 'Sep 28, 2026, 7:42 PM' (local time). A line may
 * break after the date, never inside it or the time.
 */
export function formatBackupTime(time: number): string {
  const day = unbreakable(
    new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  );
  return `${day}, ${formatTimeOfDay(time)}`;
}

/**
 * What the restore preview says a backup holds, from when the phone made it (not the
 * server's word): ['Backup from Sep 28, 2026', '7:42 PM', '10 games', 'Ava #12'], shown
 * as "Backup from Sep 28, 2026 · 7:42 PM · 10 games · Ava #12".
 */
export function cloudBackupSummary(backup: Pick<CloudBackup, 'exportedAt' | 'file'>): string[] {
  const parts = [
    `Backup from ${formatDayWithYear(backup.exportedAt)}`,
    formatTimeOfDay(backup.exportedAt),
    countGames(backup.file.games.length),
  ];
  const player = describePlayer(backup.file);
  if (player) parts.push(player);
  return parts;
}

const KEEP_SAFE = 'so automatic backup is paused to keep that backup safe.';

/**
 * Why backup paused in the 'paused-shrink' state, with the counts: e.g. 'None of the
 * 10 games in your last backup are on this phone, so automatic backup is paused to
 * keep that backup safe.'
 */
export function shrinkMessage(shrink: CloudBackupStatus['shrink']): string {
  if (!shrink) return `Some games in your last backup aren't on this phone, ${KEEP_SAFE}`;
  const { backedUpGames: total, missingGames: missing } = shrink;
  // The guard also pauses when the backup had stats and the phone has none at all.
  if (missing === 0) return `Your last backup has stats but this phone has none, ${KEEP_SAFE}`;
  if (missing >= total) {
    if (total === 1) return `The game in your last backup isn't on this phone, ${KEEP_SAFE}`;
    if (total === 2) {
      return `Neither of the 2 games in your last backup is on this phone, ${KEEP_SAFE}`;
    }
    return `None of the ${total} games in your last backup are on this phone, ${KEEP_SAFE}`;
  }
  const verb = missing === 1 ? "isn't" : "aren't";
  return `${missing} of the ${total} games in your last backup ${verb} on this phone, ${KEEP_SAFE}`;
}

/** Why backup paused in the 'paused-other-device' state, with when the other phone backed up. */
export function otherDeviceMessage(otherDevice: CloudBackupStatus['otherDevice'], now: number) {
  const when =
    otherDevice?.backedUpAt === undefined
      ? 'since this phone last did'
      : timeAgo(otherDevice.backedUpAt, now);
  return `Another phone backed up with this backup code ${when}, so this phone stopped backing up to keep from replacing that backup.`;
}

/**
 * - `ok`: backed up;
 * - `busy`: an upload is running;
 * - `waiting`: not backed up yet, about to be;
 * - `offline`: changes wait for a connection;
 * - `attention`: stopped, paused or failing: the parent may need to act.
 */
export type StatusTone = 'ok' | 'busy' | 'waiting' | 'offline' | 'attention';

export interface StatusLine {
  /** The headline, e.g. 'Backed up 2 minutes ago'. */
  title: string;
  /** More about it, e.g. why it paused. */
  detail?: string;
  tone: StatusTone;
}

/** A wait counted from when a message was made: "in a minute", "in 5 minutes", "in 3 hours". */
const RELATIVE_WAIT = /\bin (?:a|an|\d+) (?:minutes?|hours?|days?)\b/i;

/**
 * A stored message without its sentences that count a wait from when it was made (the
 * engine's "Hoop Stats will try again in 5 minutes."), which go stale as time passes.
 * Undefined if nothing is left.
 */
export function withoutWaits(message: string | undefined): string | undefined {
  const kept = message
    ?.split(/(?<=\.)\s+/)
    .filter((sentence) => !RELATIVE_WAIT.test(sentence))
    .join(' ');
  return kept || undefined;
}

/** The status row of Settings > Cloud backup, while backup is on. */
export function describeStatus(status: CloudBackupStatus, now: number): StatusLine {
  const last = status.lastSuccessAt;
  const lastBackedUp =
    last === undefined ? 'Not backed up yet.' : `Last backed up ${timeAgo(last, now)}.`;
  switch (status.state) {
    case 'backing-up':
      return {
        title: 'Backing up…',
        detail: last === undefined ? undefined : lastBackedUp,
        tone: 'busy',
      };
    case 'waiting-for-signal':
      return {
        title: 'Waiting for signal: will back up automatically',
        detail: `Your stats are safe on this phone. ${lastBackedUp}`,
        tone: 'offline',
      };
    case 'error': {
      const retry = status.nextAttemptAt;
      const when = retry === undefined || retry <= now ? 'soon' : formatWhen(retry, now);
      return {
        title: `Backup will try again ${when}`,
        // The title says when: the stored message's "in 5 minutes" goes stale.
        detail: withoutWaits(status.lastError?.message) ?? "The last backup didn't finish.",
        tone: 'attention',
      };
    }
    case 'needs-attention':
      return {
        title: 'Backup stopped',
        detail: status.lastError?.message ?? 'Automatic backup stopped. Back up now to try again.',
        tone: 'attention',
      };
    case 'paused-shrink':
      return { title: 'Backup paused', detail: shrinkMessage(status.shrink), tone: 'attention' };
    case 'paused-other-device':
      return {
        title: 'Backup paused',
        detail: otherDeviceMessage(status.otherDevice, now),
        tone: 'attention',
      };
    case 'idle':
      if (last === undefined) {
        return { title: 'Not backed up yet', detail: 'Will back up soon.', tone: 'waiting' };
      }
      return {
        title: `Backed up ${timeAgo(last, now)}`,
        detail: status.pendingChanges ? 'Newer changes will back up soon.' : undefined,
        tone: 'ok',
      };
  }
}

/**
 * How much of what's on this phone its online backup has, so nothing claims more:
 * - `none`: no cloud backup here (none in this build, or no code on the phone);
 * - `off`: turned off, its code kept: nothing since then is in the online backup;
 * - `complete`: on, and the last backup has everything (nothing waiting, not paused
 *   or stopped);
 * - `behind`: on and backed up before, but not what changed since (waiting to go up,
 *   or `paused` for the parent);
 * - `never`: on, and this phone hasn't backed up yet;
 * - `deleted`: stopped because the online backup was deleted;
 * - `stopped`: stopped for another reason (the code refused, the stats too big).
 */
export type BackupCoverage =
  | { kind: 'none' }
  | { kind: 'off' }
  | { kind: 'complete' }
  | { kind: 'behind'; lastSuccessAt: number; paused: boolean }
  | { kind: 'never' }
  | { kind: 'deleted' }
  | { kind: 'stopped' };

/** See BackupCoverage. `code` is this phone's backup code (on, or kept while off), or null. */
export function backupCoverage(status: CloudBackupStatus, code: string | null): BackupCoverage {
  if (!status.available) return { kind: 'none' };
  if (!status.enabled) return code === null ? { kind: 'none' } : { kind: 'off' };
  if (status.state === 'needs-attention') {
    return status.lastError?.kind === 'account-deleted' ? { kind: 'deleted' } : { kind: 'stopped' };
  }
  const last = status.lastSuccessAt;
  if (last === undefined) return { kind: 'never' };
  const paused = status.state === 'paused-shrink' || status.state === 'paused-other-device';
  if (paused || status.pendingChanges) return { kind: 'behind', lastSuccessAt: last, paused };
  return { kind: 'complete' };
}

/**
 * Cloud backup has, or will soon have, everything on this phone: on and working, maybe
 * with changes waiting for signal (for the backup files' note).
 */
export function backupKeepsUp(coverage: BackupCoverage): boolean {
  return coverage.kind === 'complete' || (coverage.kind === 'behind' && !coverage.paused);
}

/**
 * What "Erase all data" says about the online backup, or '' without one. Only a backup
 * that has everything is called safe; otherwise it says what isn't in it. The row it
 * names exists in that state ("Turn off" leads to it unless paused for another phone).
 */
export function eraseCloudNote(coverage: BackupCoverage, now: number): string {
  switch (coverage.kind) {
    case 'none':
      return '';
    case 'complete':
      return "Your online backup has all of it and stays: this phone keeps its code and won't replace the backup with an empty phone. To delete it too, first use Turn off and delete online backup in Cloud backup.";
    case 'behind':
      return `This phone last backed up ${timeAgo(coverage.lastSuccessAt, now)}, so anything changed since then isn't in your online backup.`;
    case 'never':
      return "This phone hasn't backed up online yet.";
    case 'off':
      return 'Cloud backup is off, so nothing changed since it was turned off is in your online backup.';
    case 'deleted':
      return 'Your online backup was deleted, so none of this is backed up online.';
    case 'stopped':
      return "Cloud backup has stopped, so your latest stats aren't backed up online.";
  }
}

/** What the share sheet shares: one line, so a note saved with it says what it is. */
const SHARE_LABEL = 'Hoop Stats backup code';

export function shareableCode(code: string): string {
  return `${SHARE_LABEL}: ${code}`;
}

/** A code as it was typed or pasted, without the label a shared copy starts with. */
export function codeFromTyped(text: string): string {
  return text.replace(/^\s*hoop\s*stats\s*backup\s*code\s*:?/i, '').trim();
}

/**
 * What the online backup has that this phone doesn't, while paused for missing games:
 * e.g. '10 games in your online backup aren't on this phone'.
 */
export function onlyOnline(shrink: CloudBackupStatus['shrink']): string {
  if (!shrink) return "Your online backup has games that aren't on this phone";
  const missing = shrink.missingGames;
  // The guard also pauses when the backup had stats and the phone has none at all.
  if (missing === 0) return "Your online backup has stats that aren't on this phone";
  return missing === 1
    ? "1 game in your online backup isn't on this phone"
    : `${missing} games in your online backup aren't on this phone`;
}

/**
 * The question before deleting the online backup (Turn off and delete, or Delete while
 * off). `onlyOnlineGames` (see onlyOnline) when it has games this phone doesn't: then the
 * stats staying on this phone is no comfort, and it says what's lost.
 */
export function deleteOnlineBackupQuestion(onlyOnlineGames?: string) {
  return {
    title: 'Delete your online backup?',
    message: onlyOnlineGames
      ? `${onlyOnlineGames}, so deleting it loses them for good. Every backup saved with this code will be deleted, and this phone will forget the code. This can't be undone.`
      : "Every backup saved with this code will be deleted, and this phone will forget the code. The stats on this phone stay. This can't be undone.",
    confirmLabel: 'Delete online backup',
    destructive: true,
  };
}

/** What the server keeps, for the questions that replace the latest backup. */
const OLDER_BACKUPS =
  'Older backups stay available for a while: the server keeps your last 20, plus one for each of the last 180 days you backed up.';

/** The "Back up anyway" question in the 'paused-shrink' state. */
export function backUpAnywayMessage(shrink: CloudBackupStatus['shrink']): string {
  const missing = shrink?.missingGames ?? 0;
  let without = '';
  if (missing === 1) without = ', without the missing game';
  else if (missing > 1) without = `, without the ${missing} missing games`;
  return `This replaces your online backup with what's on this phone${without}. ${OLDER_BACKUPS}`;
}

/** The "Use this phone for backups" question in the 'paused-other-device' state. */
export const USE_THIS_PHONE_MESSAGE = `This phone's stats will replace the other phone's latest backup, and the other phone's backups will pause, the way this phone's did. ${OLDER_BACKUPS}`;
