import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

type Venue = 'home' | 'away' | 'neutral';

const venues: SegmentedOption<Venue>[] = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
  { value: 'neutral', label: 'Neutral' },
];

/** A controlled SegmentedControl, like a screen would use it. */
function VenuePicker({ initial, onChange }: { initial: Venue; onChange?: (value: Venue) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <SegmentedControl
      aria-label="Venue"
      options={venues}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function renderPicker(initial: Venue = 'home') {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<VenuePicker initial={initial} onChange={onChange} />);
  return { user, onChange };
}

const segment = (name: string) => screen.getByRole('radio', { name });

describe('SegmentedControl', () => {
  it('is a labelled radio group with the current value checked', () => {
    renderPicker('away');
    expect(screen.getByRole('radiogroup', { name: 'Venue' })).toHaveClass('control', 'md');
    expect(segment('Away')).toHaveAttribute('aria-checked', 'true');
    expect(segment('Home')).toHaveAttribute('aria-checked', 'false');
    expect(segment('Neutral')).toHaveAttribute('aria-checked', 'false');
  });

  it('selects a segment when tapped', async () => {
    const { user, onChange } = renderPicker();
    await user.click(segment('Neutral'));
    expect(onChange).toHaveBeenCalledWith('neutral');
    expect(segment('Neutral')).toBeChecked();
    expect(segment('Home')).not.toBeChecked();
  });

  it('ignores a tap on the segment that is already selected', async () => {
    const { user, onChange } = renderPicker();
    await user.click(segment('Home'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('puts only the selected segment in the tab order', async () => {
    const { user } = renderPicker('away');
    expect(segment('Away')).toHaveAttribute('tabindex', '0');
    expect(segment('Home')).toHaveAttribute('tabindex', '-1');

    await user.tab();
    expect(segment('Away')).toHaveFocus();
  });

  it('moves the selection with the arrow keys and wraps at the ends', async () => {
    const { user, onChange } = renderPicker();
    await user.tab();

    await user.keyboard('{ArrowRight}');
    expect(segment('Away')).toHaveFocus();
    expect(segment('Away')).toBeChecked();

    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(segment('Home')).toHaveFocus();
    expect(segment('Home')).toBeChecked();

    await user.keyboard('{ArrowLeft}');
    expect(segment('Neutral')).toBeChecked();

    await user.keyboard('{ArrowUp}');
    expect(segment('Away')).toBeChecked();
    expect(onChange.mock.calls).toEqual([['away'], ['neutral'], ['home'], ['neutral'], ['away']]);
  });

  it('jumps to the first and last segment with Home and End', async () => {
    const { user } = renderPicker('away');
    await user.tab();

    await user.keyboard('{End}');
    expect(segment('Neutral')).toHaveFocus();
    expect(segment('Neutral')).toBeChecked();

    await user.keyboard('{Home}');
    expect(segment('Home')).toHaveFocus();
    expect(segment('Home')).toBeChecked();
  });

  it('lets Tab reach the first segment when no option matches the value', async () => {
    const user = userEvent.setup();
    render(
      <SegmentedControl
        aria-label="Venue"
        options={venues}
        value={'unknown' as Venue}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();

    await user.tab();
    expect(segment('Home')).toHaveFocus();
  });

  it('supports the large size and a visible label', () => {
    render(
      <>
        <span id="periods-label">Periods</span>
        <SegmentedControl
          aria-labelledby="periods-label"
          size="lg"
          options={[
            { value: 'quarters', label: 'Quarters' },
            { value: 'halves', label: 'Halves' },
          ]}
          value="halves"
          onChange={() => {}}
        />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Periods' })).toHaveClass('lg');
    expect(segment('Halves')).toBeChecked();
  });

  it('can let a long label take the room it needs, keeping its bold width', async () => {
    const user = userEvent.setup();
    function SeasonPicker() {
      const [value, setValue] = useState('fall');
      return (
        <SegmentedControl
          aria-label="Season"
          options={[
            { value: 'all', label: 'All' },
            { value: 'fall', label: 'Fall 2026' },
            { value: 'summer', label: 'Summer 2026' },
          ]}
          value={value}
          onChange={setValue}
          fitLabels
        />
      );
    }
    const { container } = render(<SeasonPicker />);
    expect(screen.getByRole('radiogroup', { name: 'Season' })).toHaveClass('fitLabels');
    // Each segment has its own column, and its label for the width it takes in bold.
    ['All', 'Fall 2026', 'Summer 2026'].forEach((label, index) => {
      expect(segment(label)).toHaveAttribute('data-label', label);
      expect(segment(label).style.gridColumn).toBe(`${index + 1}`);
    });
    // The thumb sits in the selected segment's column, and moves with the selection.
    const thumb = () => container.querySelector<HTMLElement>('.thumb');
    expect(thumb()).toHaveClass('inCell');
    expect(thumb()?.style.gridColumn).toBe('2');

    await user.click(segment('Summer 2026'));
    expect(segment('Summer 2026')).toBeChecked();
    expect(thumb()?.style.gridColumn).toBe('3');
  });

  it('slides one thumb under equal segments by default', () => {
    const { container } = render(<VenuePicker initial="away" />);
    expect(container.querySelector('.thumb')).toHaveClass('sliding');
    expect(segment('Away')).not.toHaveAttribute('data-label');
  });
});
