import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/Button/Button';
import { paths } from '@/routes';
import { renderWithRouter } from '@/test/render';
import { ScreenHeader } from './ScreenHeader';

describe('ScreenHeader', () => {
  it('renders the title as the page heading without a back link', () => {
    renderWithRouter(<ScreenHeader title="Games" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Games' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders a back link to the given route', async () => {
    const { user, router } = renderWithRouter(
      <ScreenHeader title="New game" backTo={paths.home} backLabel="Games" />,
      { path: paths.newGame },
    );
    const back = screen.getByRole('link', { name: 'Games' });
    expect(back).toHaveAttribute('href', paths.home);

    await user.click(back);
    expect(router.state.location.pathname).toBe(paths.home);
  });

  it('labels the back link "Back" by default', () => {
    renderWithRouter(<ScreenHeader title="Game report" backTo={paths.home} />);
    expect(screen.getByRole('link', { name: 'Back' })).toBeInTheDocument();
  });

  it.each([
    { case: 'without', backTo: undefined },
    { case: 'with', backTo: paths.home },
  ])('renders the action slot $case a back link', ({ backTo }) => {
    renderWithRouter(<ScreenHeader title="Games" backTo={backTo} action={<Button>Edit</Button>} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});
