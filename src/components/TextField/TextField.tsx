import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './TextField.module.css';

interface FieldProps {
  /** Visible label, e.g. "Opponent". */
  label: string;
  /** Help text shown under the label, e.g. "As it should appear in reports". */
  hint?: ReactNode;
  /** Error message shown under the label; also marks the field invalid (aria-invalid). */
  error?: ReactNode;
  /** Class name for the wrapper around the label, messages and field (e.g. for margins). */
  className?: string;
}

export type TextFieldProps = Omit<ComponentPropsWithRef<'input'>, 'className'> &
  FieldProps & {
    /** Suggestions offered while typing (a <datalist>), e.g. past opponents. */
    suggestions?: readonly string[];
  };

export type TextAreaProps = Omit<ComponentPropsWithRef<'textarea'>, 'className'> & FieldProps;

interface FieldIds {
  controlId: string;
  hintId: string;
  errorId: string;
  listId: string;
  /** Error first, then hint, then any aria-describedby passed in. */
  describedBy: string | undefined;
}

function useFieldIds(
  id: string | undefined,
  { hint, error }: Pick<FieldProps, 'hint' | 'error'>,
  extraDescribedBy: string | undefined,
): FieldIds {
  const base = useId();
  const ids = {
    controlId: id ?? `${base}control`,
    hintId: `${base}hint`,
    errorId: `${base}error`,
    listId: `${base}suggestions`,
  };
  const describedBy =
    [error ? ids.errorId : null, hint ? ids.hintId : null, extraDescribedBy]
      .filter(Boolean)
      .join(' ') || undefined;
  return { ...ids, describedBy };
}

/**
 * Label, hint and error sit above the field so the iPhone keyboard never covers
 * them. The hint and error are linked to the field with aria-describedby.
 */
function Field({
  label,
  hint,
  error,
  className,
  ids,
  children,
}: FieldProps & { ids: FieldIds; children: ReactNode }) {
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={ids.controlId} className={styles.label}>
        {label}
      </label>
      {hint ? (
        <p id={ids.hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={ids.errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * A labelled text input. Every native input prop is passed to the <input>
 * (type, value, onChange, inputMode, enterKeyHint, autoComplete, required, ref, ...).
 * Text is at least 16px, so iOS doesn't zoom in when the field is focused.
 */
export function TextField({
  label,
  hint,
  error,
  className,
  suggestions,
  id,
  type = 'text',
  list,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...inputProps
}: TextFieldProps) {
  const ids = useFieldIds(id, { hint, error }, describedBy);
  const options = suggestions?.length ? [...new Set(suggestions)] : null;

  return (
    <Field label={label} hint={hint} error={error} className={className} ids={ids}>
      <input
        {...inputProps}
        id={ids.controlId}
        type={type}
        list={options ? ids.listId : list}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : ariaInvalid}
        className={cx(styles.control, styles.input)}
      />
      {options ? (
        <datalist id={ids.listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </Field>
  );
}

/** A labelled multi-line field (e.g. game notes). Takes every native textarea prop. */
export function TextArea({
  label,
  hint,
  error,
  className,
  id,
  rows = 3,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...textAreaProps
}: TextAreaProps) {
  const ids = useFieldIds(id, { hint, error }, describedBy);

  return (
    <Field label={label} hint={hint} error={error} className={className} ids={ids}>
      <textarea
        {...textAreaProps}
        id={ids.controlId}
        rows={rows}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : ariaInvalid}
        className={cx(styles.control, styles.textArea)}
      />
    </Field>
  );
}
