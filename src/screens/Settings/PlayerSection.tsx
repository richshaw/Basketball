import { useState } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import type { Player } from '@/data/types';
import { PlayerSheet } from './PlayerSheet';
import styles from './PlayerSection.module.css';

/** The jersey number if it fits the avatar, else the name's first letter. */
function avatarText(player: Player | null): string {
  const jersey = player?.jerseyNumber?.trim();
  if (jersey && jersey.length <= 3) return jersey;
  // By code point, not UTF-16 unit, so a name starting with an emoji keeps it whole.
  const [initial] = Array.from(player?.name.trim() ?? '');
  return initial?.toUpperCase() ?? '+';
}

/** The player's name and jersey number; tap to edit them. */
export function PlayerSection({ player }: { player: Player | null }) {
  const [editing, setEditing] = useState(false);
  // A fresh sheet each time, so its fields start from the saved values.
  const [sheetKey, setSheetKey] = useState(0);
  const name = player?.name.trim();
  const jersey = player?.jerseyNumber;

  const startEditing = () => {
    setSheetKey((key) => key + 1);
    setEditing(true);
  };

  let subtitle = 'Name and jersey number';
  if (name) subtitle = jersey ? `Jersey #${jersey}` : 'No jersey number';

  return (
    <div>
      <GroupedList header="Player">
        <ListRow
          className={styles.item}
          icon={<span className={styles.avatar}>{avatarText(player)}</span>}
          title={<span className={styles.name}>{name || 'Add your player'}</span>}
          subtitle={subtitle}
          chevron
          onClick={startEditing}
        />
      </GroupedList>
      <PlayerSheet
        key={sheetKey}
        open={editing}
        player={player}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}
