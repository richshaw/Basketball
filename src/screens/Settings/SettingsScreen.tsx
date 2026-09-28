import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';

/** Placeholder: player details and app options arrive in a later PR. */
export function SettingsScreen() {
  return (
    <main>
      <ScreenHeader title="Settings" />
      <ScreenBody>
        <EmptyState
          icon="⚙️"
          title="Settings are coming"
          message="Player details and app options will live here."
        />
      </ScreenBody>
    </main>
  );
}
