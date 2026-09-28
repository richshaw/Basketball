import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TextArea, TextField } from './TextField';

describe('TextField', () => {
  it('renders a text input labelled by its label', () => {
    render(<TextField label="Opponent" />);
    const input = screen.getByRole('textbox', { name: 'Opponent' });
    expect(input).toHaveAttribute('type', 'text');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(input).not.toBeInvalid();
  });

  it('describes the input with its hint', () => {
    render(<TextField label="Opponent" hint="As it should appear in reports" />);
    expect(screen.getByRole('textbox', { name: 'Opponent' })).toHaveAccessibleDescription(
      'As it should appear in reports',
    );
  });

  it('marks the input invalid and reads the error before the hint', () => {
    render(<TextField label="Opponent" hint="Team name" error="Enter the other team's name" />);
    const input = screen.getByRole('textbox', { name: 'Opponent' });
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription("Enter the other team's name Team name");
  });

  it('keeps a description and id passed in by the caller', () => {
    render(
      <>
        <p id="extra">Shown on the report</p>
        <TextField label="Opponent" id="opponent" hint="Team name" aria-describedby="extra" />
      </>,
    );
    const input = screen.getByRole('textbox', { name: 'Opponent' });
    expect(input).toHaveAttribute('id', 'opponent');
    expect(input).toHaveAccessibleDescription('Team name Shown on the report');
  });

  it('forwards native input props and the ref', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <TextField
        ref={ref}
        label="Our score"
        name="ourScore"
        inputMode="numeric"
        enterKeyHint="done"
        autoComplete="off"
        required
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Our score' });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('name', 'ourScore');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('enterkeyhint', 'done');
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toBeRequired();
  });

  it('supports other input types such as date', () => {
    render(<TextField label="Date" type="date" defaultValue="2026-09-28" />);
    expect(screen.getByLabelText('Date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Date')).toHaveValue('2026-09-28');
  });

  it('offers suggestions through a datalist', () => {
    render(<TextField label="Opponent" suggestions={['Tigers', 'Hawks', 'Tigers']} />);
    const input = screen.getByRole('combobox', { name: 'Opponent' });
    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();

    const datalist = document.getElementById(listId ?? '');
    expect(datalist?.tagName).toBe('DATALIST');
    const values = [...(datalist?.querySelectorAll('option') ?? [])].map((option) => option.value);
    expect(values).toEqual(['Tigers', 'Hawks']);
  });

  it('keeps a list attribute passed in when there are no suggestions', () => {
    render(<TextField label="Opponent" list="teams" suggestions={[]} />);
    expect(screen.getByLabelText('Opponent')).toHaveAttribute('list', 'teams');
  });

  it('works as a controlled input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState('');
      return (
        <TextField
          label="Opponent"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onChange(event.target.value);
          }}
        />
      );
    }
    render(<Controlled />);

    await user.type(screen.getByRole('textbox', { name: 'Opponent' }), 'Hawks');
    expect(screen.getByRole('textbox', { name: 'Opponent' })).toHaveValue('Hawks');
    expect(onChange).toHaveBeenLastCalledWith('Hawks');
  });

  it('puts className on the wrapper, not the input', () => {
    render(<TextField label="Opponent" className="spaced" />);
    const input = screen.getByRole('textbox', { name: 'Opponent' });
    expect(input).not.toHaveClass('spaced');
    expect(input.closest('.spaced')).toHaveClass('field');
  });
});

describe('TextArea', () => {
  it('renders a labelled multi-line field with three rows by default', () => {
    render(<TextArea label="Notes" hint="Anything worth remembering" />);
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '3');
    expect(textarea).toHaveAccessibleDescription('Anything worth remembering');
  });

  it('shows an error and forwards native props', async () => {
    const user = userEvent.setup();
    const ref = createRef<HTMLTextAreaElement>();
    render(<TextArea ref={ref} label="Notes" rows={5} maxLength={10} error="Too long" />);
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    expect(ref.current).toBe(textarea);
    expect(textarea).toHaveAttribute('rows', '5');
    expect(textarea).toBeInvalid();
    expect(textarea).toHaveAccessibleDescription('Too long');

    await user.type(textarea, 'Great defense today');
    expect(textarea).toHaveValue('Great defe');
  });
});
