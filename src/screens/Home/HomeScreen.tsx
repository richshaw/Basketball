import { ButtonLink } from '@/components/Button/ButtonLink';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { paths } from '@/routes';

/** Placeholder: the game list arrives in a later PR. */
export function HomeScreen() {
  return (
    <main>
      <ScreenHeader title="Games" />
      <ScreenBody>
        <EmptyState
          icon="🏀"
          title="Your games will live here"
          message="Coming soon: start a game, tap stats as they happen, and find every game in this list."
          action={
            <ButtonLink to={paths.newGame} size="lg">
              New game
            </ButtonLink>
          }
        />
      </ScreenBody>
    </main>
  );
}
