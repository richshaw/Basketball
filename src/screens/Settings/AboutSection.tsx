import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { useToast } from '@/components/Toast/toastContext';
import { seedDemoData } from '@/data/demo';
import { clearAllData } from '@/data/transfer';
import type { Game, Player } from '@/data/types';
import { paths } from '@/routes';
import { ActionRow } from './ActionRow';
import { APP_VERSION } from './appVersion';

export interface AboutSectionProps {
  player: Player | null;
  games: readonly Game[];
}

/** What "Erase all data" will delete, spelled out. */
function eraseMessage(gameCount: number): string {
  if (gameCount === 0) {
    return "The player's name and number and your settings will be deleted from this phone. This can't be undone.";
  }
  const games =
    gameCount === 1
      ? 'The game on this phone and its stats'
      : `All ${gameCount} games and their stats`;
  return `${games}, the player's name and number, and your settings will be deleted from this phone. This can't be undone. If you might want them back, save a backup file first.`;
}

/** The version, sample data for a first look, and erasing everything. */
export function AboutSection({ player, games }: AboutSectionProps) {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [addingSample, setAddingSample] = useState(false);
  // Only on a fresh phone: sample data replaces everything, including the player.
  const canTrySample = games.length === 0 && !player?.name.trim();

  const addSampleData = async () => {
    if (addingSample) return;
    setAddingSample(true);
    try {
      await seedDemoData();
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

  const eraseAll = async () => {
    const confirmed = await confirm({
      title: 'Erase all data?',
      message: eraseMessage(games.length),
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
            subtitle="Adds a sample player with 10 finished games to look around. Erase them any time below."
            onClick={addSampleData}
            disabled={addingSample}
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
