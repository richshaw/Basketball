import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatTile, StatTileGrid } from './StatTile';

describe('StatTile', () => {
  it('pairs the label (term) with its value (definition) for screen readers', () => {
    render(
      <StatTileGrid aria-label="Game totals">
        <StatTile value={14} label="PTS" fullLabel="Points" detail="5/9 FG" />
      </StatTileGrid>,
    );
    const term = screen.getByRole('term');
    expect(term).toHaveTextContent('PTSPoints');
    expect(screen.getByText('PTS')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Points')).toHaveClass('visually-hidden');

    const definitions = screen.getAllByRole('definition');
    expect(definitions.map((definition) => definition.textContent)).toEqual(['14', '5/9 FG']);
    expect(definitions[0]).toHaveClass('value');
  });

  it('renders just the label and value when that is all it has', () => {
    render(
      <StatTileGrid>
        <StatTile value={3} label="AST" />
      </StatTileGrid>,
    );
    expect(screen.getByRole('term')).toHaveTextContent('AST');
    expect(screen.getAllByRole('definition')).toHaveLength(1);
  });

  it('highlights the headline stat', () => {
    render(
      <StatTileGrid>
        <StatTile value={14} label="PTS" highlight />
        <StatTile value={7} label="REB" />
      </StatTileGrid>,
    );
    expect(screen.getByText('14').parentElement).toHaveClass('tile', 'highlight');
    expect(screen.getByText('7').parentElement).not.toHaveClass('highlight');
  });
});

describe('StatTileGrid', () => {
  it('is a description list that auto-fits its tiles by default', () => {
    const { container } = render(
      <StatTileGrid aria-label="Game totals">
        <StatTile value={14} label="PTS" />
      </StatTileGrid>,
    );
    const grid = container.querySelector('dl');
    expect(grid).toHaveClass('grid');
    expect(grid).toHaveAttribute('aria-label', 'Game totals');
    expect(grid?.className).not.toMatch(/columns/);
  });

  it('can fix the number of tiles per row', () => {
    const { container } = render(
      <StatTileGrid columns={3}>
        <StatTile value="45%" label="FG%" />
      </StatTileGrid>,
    );
    expect(container.querySelector('dl')).toHaveClass('grid', 'columns3');
  });
});
