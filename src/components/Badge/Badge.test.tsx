import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders a neutral badge by default', () => {
    render(<Badge>Final</Badge>);
    expect(screen.getByText('Final')).toHaveClass('badge', 'neutral');
  });

  it.each(['accent', 'made', 'miss', 'stat'] as const)('renders the %s tone', (tone) => {
    render(<Badge tone={tone}>Live</Badge>);
    expect(screen.getByText('Live')).toHaveClass(tone);
  });

  it('forwards native props', () => {
    render(
      <Badge className="extra" title="Win">
        W
      </Badge>,
    );
    expect(screen.getByTitle('Win')).toHaveClass('badge', 'extra');
  });
});
