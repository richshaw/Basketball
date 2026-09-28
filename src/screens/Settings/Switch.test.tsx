import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './Switch';

function Controlled({ onChange }: { onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(true);
  return (
    <>
      <span id="label">Shot chart</span>
      <Switch
        aria-labelledby="label"
        checked={checked}
        onChange={(next) => {
          onChange?.(next);
          setChecked(next);
        }}
      />
    </>
  );
}

describe('Switch', () => {
  it('is a switch named by its label that reports its state', () => {
    render(<Controlled />);
    const toggle = screen.getByRole('switch', { name: 'Shot chart' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('type', 'button');
  });

  it('turns off and on with a tap or the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Shot chart' });

    await user.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle).not.toBeChecked();

    toggle.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle).toBeChecked();
  });

  it('does nothing while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch aria-label="Shot chart" checked={false} onChange={onChange} disabled />);
    await user.click(screen.getByRole('switch', { name: 'Shot chart' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
