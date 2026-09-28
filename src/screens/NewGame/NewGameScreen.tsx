import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { paths } from '@/routes';

/** Placeholder: the new-game form arrives in a later PR. */
export function NewGameScreen() {
  return (
    <main>
      <ScreenHeader title="New game" backTo={paths.home} backLabel="Games" />
      <ScreenBody>
        <EmptyState
          icon="📝"
          title="Game setup is coming"
          message="Enter the opponent and date, then start tracking."
        />
      </ScreenBody>
    </main>
  );
}
