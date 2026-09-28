import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';

/** Placeholder: season totals and averages arrive in a later PR. */
export function SeasonStatsScreen() {
  return (
    <main>
      <ScreenHeader title="Stats" />
      <ScreenBody>
        <EmptyState
          icon="📊"
          title="Season stats are coming"
          message="Totals, averages and shooting percentages across every game will show up here."
        />
      </ScreenBody>
    </main>
  );
}
