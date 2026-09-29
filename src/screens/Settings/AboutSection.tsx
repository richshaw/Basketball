import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { useToast } from '@/components/Toast/toastContext';
import { addSampleData, isDemoGameId, isDemoPlayer, removeDemoData } from '@/data/demo';
import { clearAllData } from '@/data/transfer';
import type { Game, Player } from '@/data/types';
import { formatPlayerName } from '@/lib/format';
import { paths } from '@/routes';
import { ActionRow } from './ActionRow';
import { APP_VERSION } from './appVersion';
import { formatDayWithYear, type LastBackupFile } from './backupFiles';
import { eraseCloudNote, type BackupCoverage } from './cloudBackupText';

export interface AboutSectionProps {
  player: Player | null;
  games: readonly Game[];
  /** How much of this phone's data its online backup has (see backupCoverage). */
  cloudCoverage?: BackupCoverage;
  /** The last backup file saved on this phone, while it has all of its data (see backupFileIsCurrent). */
  currentBackupFile?: LastBackupFile;
}

/**
 * What "Erase all data" will delete, spelled out, what the online backup has of it (see
 * eraseCloudNote), and, with games to lose, saving a backup file first, unless the last
 * one saved here (`savedFile`) still has all of it: then it says so instead.
 */
function eraseMessage(
  gameCount: number,
  coverage: BackupCoverage,
  now: number,
  savedFile?: LastBackupFile,
): string {
  const cloud = eraseCloudNote(coverage, now);
  const parts: string[] = [];
  if (gameCount === 0) {
    parts.push(
      "The player's name and number and your settings will be deleted from this phone. This can't be undone.",
    );
    if (cloud) parts.push(cloud);
  } else {
    const games =
      gameCount === 1
        ? 'The game on this phone and its stats'
        : `All ${gameCount} games and their stats`;
    parts.push(
      `${games}, the player's name and number, and your settings will be deleted from this phone. This can't be undone.`,
    );
    if (cloud) parts.push(cloud);
    if (savedFile) {
      const day = formatDayWithYear(savedFile.savedAt);
      const too = coverage.kind === 'complete' ? ' too' : '';
      parts.push(`The backup file you saved on ${day} has all of it${too}.`);
    } else {
      parts.push(
        coverage.kind === 'complete'
          ? 'For a copy of your own as well, save a backup file first.'
          : 'If you might want them back, save a backup file first.',
      );
    }
  }
  return parts.join(' ');
}

/**
 * What "Remove sample games" deletes: the sample games, and the sample player too while
 * she's still as the sample data made her (`samplePlayer`); a player of the parent's own
 * stays.
 */
function removeSampleSubtitle(count: number, samplePlayer: Player | null): string {
  const games = count === 1 ? 'sample game' : `${count} sample games`;
  if (samplePlayer) {
    const name = `${formatPlayerName(samplePlayer)} #${samplePlayer.jerseyNumber ?? ''}`;
    return `Deletes just the ${games} and the sample player, ${name}. Your settings and any games of your own stay.`;
  }
  return `Deletes just the ${games}. The player, your settings and any games of your own stay.`;
}

/**
 * What "Try it with sample data" adds: the sample games for the player the parent set up
 * (a name or a number), else with a sample player (see addSampleData).
 */
function trySampleSubtitle(player: Player | null): string {
  const later = 'You can remove them here any time.';
  if (!player?.name.trim() && !player?.jerseyNumber) {
    return `Adds a sample player with 10 finished games to look around. ${later}`;
  }
  const name = player.name.trim() || 'your player';
  return `Adds 10 finished sample games for ${name} to look around. ${later}`;
}

/** The version, sample data to look around with (and removing it), and erasing everything. */
export function AboutSection({
  player,
  games,
  cloudCoverage = { kind: 'none' },
  currentBackupFile,
}: AboutSectionProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [addingSample, setAddingSample] = useState(false);
  const [removingSample, setRemovingSample] = useState(false);
  // Whenever there are no games (sample ones included), named player or not.
  const canTrySample = games.length === 0;
  const sampleGameCount = games.filter((game) => isDemoGameId(game.id)).length;
  // Still the sample player: removing the sample games takes her name and number too.
  const samplePlayer = player && isDemoPlayer(player) ? player : null;

  const trySampleData = async () => {
    if (addingSample) return;
    setAddingSample(true);
    try {
      // Checked again against the database. The Game setup chosen here stays as it is.
      if (!(await addSampleData())) {
        toast.show({ message: 'This phone has games of its own now, so nothing was added.' });
        return;
      }
      toast.show({
        message: 'Sample games added',
        actionLabel: 'See games',
        onAction: () => void navigate(paths.home),
      });
    } catch (error) {
      console.error('Adding sample data failed', error);
      toast.show({ message: "Couldn't add the sample games. Try again." });
    } finally {
      setAddingSample(false);
    }
  };

  const removeSampleGames = async () => {
    if (removingSample) return;
    setRemovingSample(true);
    try {
      // Games of the parent's own, a player she named and the settings stay.
      const removed = await removeDemoData();
      toast.show({ message: removed === 1 ? 'Sample game removed' : 'Sample games removed' });
    } catch (error) {
      console.error('Removing the sample games failed', error);
      toast.show({ message: "Couldn't remove the sample games. Try again." });
    } finally {
      setRemovingSample(false);
    }
  };

  const eraseAll = async () => {
    const confirmed = await confirm({
      title: 'Erase all data?',
      message: eraseMessage(games.length, cloudCoverage, Date.now(), currentBackupFile),
      confirmLabel: 'Erase all data',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await clearAllData();
      toast.show({ message: 'All data erased' });
    } catch (error) {
      console.error('Erasing all data failed', error);
      toast.show({ message: "Couldn't erase the data. Try again." });
    }
  };

  return (
    <div>
      <GroupedList header="About">
        <ListRow title="Version" value={APP_VERSION} />
        {canTrySample ? (
          <ActionRow
            title="Try it with sample data"
            subtitle={trySampleSubtitle(player)}
            onClick={trySampleData}
            disabled={addingSample}
          />
        ) : null}
        {sampleGameCount > 0 ? (
          <ListRow
            title="Remove sample games"
            subtitle={removeSampleSubtitle(sampleGameCount, samplePlayer)}
            destructive
            onClick={removeSampleGames}
            disabled={removingSample}
          />
        ) : null}
      </GroupedList>
      <GroupedList
        aria-label="Erase"
        footer="Deletes the player, every game and your settings from this phone."
      >
        <ListRow title="Erase all data" destructive onClick={eraseAll} />
      </GroupedList>
    </div>
  );
}
