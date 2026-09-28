import { useState } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { InstallSheet } from '@/components/InstallBanner/InstallSheet';

/** How to add the app to the Home Screen. SettingsScreen shows it only in a browser tab. */
export function InstallSection() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <GroupedList
        header="Home Screen"
        footer="As a Home Screen app, Hoop Stats works offline and keeps your stats safe."
      >
        <ListRow title="Add to Home Screen" chevron onClick={() => setOpen(true)} />
      </GroupedList>
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
