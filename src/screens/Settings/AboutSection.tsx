import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { useToast } from '@/components/Toast/toastContext';
import { isDemoGameId, seedDemoData } from '@/data/demo';
import { deleteGame, getPlayer, listGames } from '@/data/repo';
import { clearAllData } from '@/data/transfer';
import type { Game, Player } from '@/data/types';
import { paths } from '@/routes';
import { ActionRow } from './ActionRow';
import { APP_VERSION } from './appVersion';
import { eraseCloudNote, type BackupCoverage } from './cloudBackupText';

export interface AboutSectionProps {
  player: Player | null;
  games: readonly Game[];
  /** How much of this phone's data its online backup has (see backupCoverage). */
  cloudCoverage?: BackupCoverage;
}

/**
 * What "Erase all data" will delete, spelled out, what the online backup has of it (see
 * eraseCloudNote), and, with games to lose, saving a backup file first.
 */
function eraseMessage(gameCount: number, coverage: BackupCoverage, now: number): string {
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
    parts.push(
      coverage.kind === 'complete'
        ? 'For a copy of your own as well, save a backup file first.'
        : 'If you might want them back, save a backup file first.',
    );
  }
  return parts.join(' ');
}

/**
 * No games, and nothing the parent entered: sample data may replace the player. A
 * player that a first game created and never named counts as nothing (the game may
 * have been a test, since deleted).
 */
function isFreshPhone(player: Player | null | undefined, games: readonly Game[]): boolean {
  return games.length === 0 && !player?.name.trim() && !player?.jerseyNumber;
}

/** The version, sample data to look around with (and removing it), and erasing everything. */
export function AboutSection({
  player,
  games,
  cloudCoverage = { kind: 'none' },
}: AboutSectionProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [addingSample, setAddingSample] = useState(false);
  const [removingSample, setRemovingSample] = useState(false);
  const canTrySample = isFreshPhone(player, games);
  const sampleGameCount = games.filter((game) => isDemoGameId(game.id)).length;

  const addSampleData = async () => {
    if (addingSample) return;
    setAddingSample(true);
    try {
      // Checked again against the database, as the sample data replaces the player
      // (so `force`: seedDemoData refuses to replace even an unnamed player).
      const [currentPlayer, currentGames] = await Promise.all([getPlayer(), listGames()]);
      if (!isFreshPhone(currentPlayer, currentGames)) {
        toast.show({ message: 'This phone has games of its own now, so nothing was added.' });
        return;
      }
      // The Game setup chosen here stays as it is.
      await seedDemoData({ force: true, keepSettings: true });
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
      // Only the sample games: games of the parent's own, the player and the settings stay.
      const sampleIds = (await listGames()).map((game) => game.id).filter(isDemoGameId);
      for (const id of sampleIds) await deleteGame(id);
      toast.show({
        message: sampleIds.length === 1 ? 'Sample game removed' : 'Sample games removed',
      });
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
      message: eraseMessage(games.length, cloudCoverage, Date.now()),
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
            subtitle="Adds a sample player with 10 finished games to look around. You can remove the games here any time."
            onClick={addSampleData}
            disabled={addingSample}
          />
        ) : null}
        {sampleGameCount > 0 ? (
          <ListRow
            title="Remove sample games"
            subtitle={`Deletes just the ${sampleGameCount === 1 ? 'sample game' : `${sampleGameCount} sample games`}. The player, your settings and any games of your own stay.`}
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
