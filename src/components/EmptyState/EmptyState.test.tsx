import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/Button/Button';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title, message and action', () => {
    render(
      <EmptyState
        icon="🏀"
        title="No games yet"
        message="Start a game to see it here."
        action={<Button>New game</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'No games yet' })).toBeInTheDocument();
    expect(screen.getByText('Start a game to see it here.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New game' })).toBeInTheDocument();
  });

  it('hides the decorative icon from screen readers', () => {
    render(<EmptyState icon="🏀" title="No games yet" />);
    expect(screen.getByText('🏀')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders only the title when nothing else is given', () => {
    const { container } = render(<EmptyState title="Nothing here" />);
    expect(container.querySelectorAll('p, button, [aria-hidden]')).toHaveLength(0);
  });
});
