import { fireEvent, render, screen, within } from '@testing-library/react';
import { Link } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/test/render';
import { StatTable, type StatTableColumn, type StatTableRow } from './StatTable';

type Key = 'period' | 'pts' | 'fg' | 'reb';

const columns: StatTableColumn<Key>[] = [
  { key: 'period', header: 'Qtr', fullLabel: 'Quarter' },
  { key: 'pts', header: 'PTS', fullLabel: 'Points' },
  { key: 'fg', header: 'FG', fullLabel: 'Field goals', align: 'end', width: '4rem' },
  { key: 'reb', header: 'REB' },
];

const rows: StatTableRow<Key>[] = [
  { period: 'Q1', pts: 4, fg: '2-3', reb: 1 },
  { period: 'Q2', pts: 6, fg: '2-4', reb: 3 },
];

const total: StatTableRow<Key> = { period: 'Total', pts: 10, fg: '4-7', reb: 4 };

function renderTable(props: Partial<Parameters<typeof StatTable<Key>>[0]> = {}) {
  return render(<StatTable caption="Points by quarter" columns={columns} rows={rows} {...props} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StatTable', () => {
  it('renders a table named by its caption, inside a named region', () => {
    renderTable();
    expect(screen.getByRole('table', { name: 'Points by quarter' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Points by quarter' })).toBeInTheDocument();
  });

  it('reads the full column names to screen readers', () => {
    renderTable();
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['QtrQuarter', 'PTSPoints', 'FGField goals', 'REB']);
    expect(screen.getByRole('columnheader', { name: 'Points' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'REB' })).toBeInTheDocument();
  });

  it('puts each value under its column, with the first cell as the row header', () => {
    renderTable();
    const q2 = screen.getByRole('row', { name: /Q2/ });
    expect(within(q2).getByRole('rowheader', { name: 'Q2' })).toHaveClass('sticky');
    expect(
      within(q2)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['6', '2-4', '3']);
  });

  it('aligns the first column to the start and the rest to the center unless told otherwise', () => {
    renderTable();
    const q1 = screen.getByRole('row', { name: /Q1/ });
    expect(within(q1).getByRole('rowheader')).toHaveClass('start');
    const [pts, fg] = within(q1).getAllByRole('cell');
    expect(pts).toHaveClass('center');
    expect(fg).toHaveClass('end');
  });

  it('applies column widths', () => {
    const { container } = renderTable();
    const cols = container.querySelectorAll('col');
    expect(cols).toHaveLength(4);
    expect(cols[2]?.style.width).toBe('4rem');
    expect(cols[0]).not.toHaveAttribute('style');
  });

  it('shows a totals row in the table footer', () => {
    const { container } = renderTable({ totalRow: total });
    const footer = container.querySelector('tfoot');
    expect(footer).not.toBeNull();
    const totals = within(footer as HTMLElement).getByRole('row');
    expect(totals).toHaveClass('totalRow');
    expect(within(totals).getByRole('rowheader', { name: 'Total' })).toBeInTheDocument();
    expect(totals).toHaveTextContent('Total104-74');
  });

  it('highlights one row, and says so to screen readers', () => {
    renderTable({ highlightedRow: 1 });
    expect(screen.getByRole('row', { name: /Q2/ })).toHaveClass('highlighted');
    expect(screen.getByRole('rowheader', { name: 'Q2, current' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Q1/ })).not.toHaveClass('highlighted');
    expect(screen.getByRole('rowheader', { name: 'Q1' })).toBeInTheDocument();
  });

  it('says what the highlight means when told', () => {
    renderTable({ highlightedRow: 0, highlightLabel: 'season high' });
    expect(screen.getByRole('rowheader', { name: 'Q1, season high' })).toBeInTheDocument();
  });

  it('is not focusable while everything fits', () => {
    renderTable();
    expect(screen.getByRole('region')).not.toHaveAttribute('tabindex');
  });

  it('becomes focusable and tracks its edges when the columns overflow', () => {
    // jsdom has no layout: fake a 358px-wide scroller holding an 800px-wide table.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
        }
        observe() {
          this.callback();
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(800);
    const scrollLeft = vi.spyOn(Element.prototype, 'scrollLeft', 'get').mockReturnValue(0);

    renderTable();
    const region = screen.getByRole('region', { name: 'Points by quarter' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region).toHaveClass('moreAtEnd');
    expect(region).not.toHaveClass('scrolledStart');

    scrollLeft.mockReturnValue(442);
    fireEvent.scroll(region);
    expect(region).toHaveClass('scrolledStart');
    expect(region).not.toHaveClass('moreAtEnd');
  });

  it('leaves rows untappable by default', () => {
    renderTable();
    expect(screen.getByRole('row', { name: /Q1/ })).not.toHaveClass('linkedRow');
  });

  it('with linkedRows, follows the row link from a tap anywhere on the row', async () => {
    const linkRows: StatTableRow<Key>[] = [
      { period: <Link to="/periods/Q1">Q1</Link>, pts: 4, fg: '2-3', reb: 1 },
      { period: <Link to="/periods/Q2">Q2</Link>, pts: 6, fg: '2-4', reb: 3 },
    ];
    const { user, router } = renderWithRouter(
      <StatTable caption="Points by quarter" columns={columns} rows={linkRows} linkedRows />,
    );

    const q2 = screen.getByRole('row', { name: /Q2/ });
    expect(q2).toHaveClass('linkedRow');
    await user.click(within(q2).getByRole('cell', { name: '6' }));
    expect(router.state.location.pathname).toBe('/periods/Q2');

    // The link itself still works on its own, and navigates just once.
    const visited = new Set<string>();
    const unsubscribe = router.subscribe((state) => visited.add(state.location.key));
    await user.click(screen.getByRole('link', { name: 'Q1' }));
    unsubscribe();
    expect(router.state.location.pathname).toBe('/periods/Q1');
    expect(visited.size).toBe(1);
  });
});
