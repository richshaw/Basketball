import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { paths } from '@/routes';
import { renderWithRouter } from '@/test/render';
import { Button } from './Button';
import { ButtonLink } from './ButtonLink';

describe('Button', () => {
  it('defaults to a medium primary button that never submits forms', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('button', 'primary', 'md');
    expect(button).not.toHaveClass('block');
  });

  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)(
    'renders the %s variant',
    (variant) => {
      render(<Button variant={variant}>Tap</Button>);
      expect(screen.getByRole('button', { name: 'Tap' })).toHaveClass(variant);
    },
  );

  it('supports the large size and full width', () => {
    render(
      <Button size="lg" block>
        Start game
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Start game' })).toHaveClass('lg', 'block');
  });

  it('forwards native props, class names and the ref', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} type="submit" aria-label="Add two points" className="extra">
        +2
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Add two points' });
    expect(ref.current).toBe(button);
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveClass('button', 'extra');
  });

  it('calls onClick when tapped but not while disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Made</Button>);
    await user.click(screen.getByRole('button', { name: 'Made' }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <Button onClick={onClick} disabled>
        Made
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'Made' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('ButtonLink', () => {
  it('renders a router link styled like a button', () => {
    renderWithRouter(
      <ButtonLink to={paths.stats} variant="secondary" size="lg">
        See stats
      </ButtonLink>,
    );
    const link = screen.getByRole('link', { name: 'See stats' });
    expect(link).toHaveAttribute('href', paths.stats);
    expect(link).toHaveClass('button', 'secondary', 'lg');
  });
});
