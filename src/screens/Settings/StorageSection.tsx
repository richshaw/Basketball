import { useEffect, useState } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { getStorageStatus, type StorageStatus } from '@/data/persistence';
import { formatBytes, protectionExplanation, protectionLabel } from './storageInfo';

export interface StorageSectionProps {
  /** Running as the Home Screen app. */
  standalone: boolean;
  /** The games, only so the numbers refresh when the data changes. */
  dataVersion: unknown;
}

/** Whether the browser promised to keep the data, and how much space it takes. */
export function StorageSection({ standalone, dataVersion }: StorageSectionProps) {
  const [status, setStatus] = useState<StorageStatus | undefined>();

  useEffect(() => {
    let current = true;
    void getStorageStatus().then((next) => {
      if (current) setStatus(next);
    });
    return () => {
      current = false;
    };
  }, [dataVersion]);

  return (
    <div>
      <GroupedList
        header="Storage"
        footer={status ? protectionExplanation(status.persisted, standalone) : undefined}
      >
        <ListRow
          title="Protected from automatic clearing"
          value={status ? protectionLabel(status.persisted) : undefined}
        />
        {status?.usage === undefined ? null : (
          <ListRow title="Space used" value={formatBytes(status.usage)} />
        )}
      </GroupedList>
    </div>
  );
}
