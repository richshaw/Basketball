import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge } from '@/components/Badge/Badge';
import { paths } from '@/routes';
import { renderWithRouter } from '@/test/render';
import { GroupedList } from './GroupedList';
import { ListRow } from './ListRow';

describe('GroupedList', () => {
  it('renders the header as a heading that names the list, and the footer', () => {
    render(
      <GroupedList header="Backup" footer="Your stats only live on this phone.">
        <ListRow title="Export" />
        <ListRow title="Import" />
      </GroupedList>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Backup' })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Backup' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Your stats only live on this phone.')).toBeInTheDocument();
  });

  it('supports another heading level', () => {
    render(
      <GroupedList header="Earlier" headingLevel={3}>
        <ListRow title="vs Hawks" />
      </GroupedList>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Earlier' })).toBeInTheDocument();
  });

  it('can be named with aria-label when it has no header', () => {
    render(
      <GroupedList aria-label="Games">
        <ListRow title="vs Hawks" />
      </GroupedList>,
    );
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Games' })).toBeInTheDocument();
  });
});

describe('ListRow', () => {
  it('links to a route, with a chevron by default', async () => {
    const { user, router } = renderWithRouter(
      <GroupedList header="Games">
        <ListRow
          title="vs Tigers"
          subtitle="Sat, Oct 12 · Home"
          value={<Badge tone="made">W</Badge>}
          to={paths.gameReport('g1')}
        />
      </GroupedList>,
    );
    const link = screen.getByRole('link', { name: /vs Tigers/ });
    expect(link).toHaveAttribute('href', paths.gameReport('g1'));
    expect(link).toHaveTextContent('Sat, Oct 12 · Home');
    expect(link).toHaveTextContent('W');
    expect(link.querySelector('svg')).toHaveClass('chevron');

    await user.click(link);
    expect(router.state.location.pathname).toBe(paths.gameReport('g1'));
  });

  it('acts as a button without a chevron by default', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <GroupedList header="Backup">
        <ListRow title="Export backup" onClick={onClick} />
      </GroupedList>,
    );
    const button = screen.getByRole('button', { name: 'Export backup' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button.querySelector('svg')).toBeNull();

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire a disabled button row', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <GroupedList header="Backup">
        <ListRow title="Import backup" onClick={onClick} disabled />
      </GroupedList>,
    );
    const button = screen.getByRole('button', { name: 'Import backup' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders a static row with a value and no control', () => {
    render(
      <GroupedList header="About">
        <ListRow title="Version" value="1.0.0" />
      </GroupedList>,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Version1.0.0');
    expect(within(item).queryByRole('button')).not.toBeInTheDocument();
    expect(within(item).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows a value of zero', () => {
    render(
      <GroupedList header="Season">
        <ListRow title="Games" value={0} />
      </GroupedList>,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Games0');
  });

  it('styles destructive rows, hides the icon from screen readers and allows a chevron', () => {
    render(
      <GroupedList header="Danger zone">
        <ListRow title="Delete all data" icon="🗑️" onClick={() => {}} destructive chevron />
      </GroupedList>,
    );
    const button = screen.getByRole('button', { name: 'Delete all data' });
    expect(button).toHaveClass('row', 'interactive', 'destructive');
    expect(screen.getByText('🗑️')).toHaveAttribute('aria-hidden', 'true');
    expect(button.querySelector('svg')).toHaveClass('chevron');
    expect(screen.getByRole('listitem')).toHaveClass('item', 'withIcon');
  });
});
