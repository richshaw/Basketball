import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import { TextField } from '@/components/TextField/TextField';
import { useToast } from '@/components/Toast/toastContext';
import { savePlayer } from '@/data/repo';
import { TEXT_LIMITS, type Player } from '@/data/types';
import styles from './PlayerSheet.module.css';

export interface PlayerSheetProps {
  open: boolean;
  /** The player to edit, or null to set one up. The fields start from these values. */
  player: Player | null;
  onClose: () => void;
}

/**
 * Edits the player's name and jersey number. Mount it with a new `key` each time it
 * opens, so the fields start from the saved values.
 */
export function PlayerSheet({ open, player, onClose }: PlayerSheetProps) {
  const toast = useToast();
  const formId = useId();
  const jerseyRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(player?.name ?? '');
  const [jerseyNumber, setJerseyNumber] = useState(player?.jerseyNumber ?? '');
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError('Enter a name');
      return;
    }
    setSaving(true);
    try {
      // An empty jersey number clears it.
      await savePlayer({ name: trimmedName, jerseyNumber: jerseyNumber.trim() });
      onClose();
    } catch (error) {
      console.error('Saving the player failed', error);
      toast.show({ message: "Couldn't save. Try again." });
    } finally {
      setSaving(false);
    }
  };

  // The keyboard's "next" key moves on to the jersey number instead of saving.
  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    jerseyRef.current?.focus();
  };

  // Its "done" key saves (the Save button sits outside the form, in the sheet's footer).
  const handleJerseyKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const form = event.currentTarget.form;
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (typeof form?.requestSubmit !== 'function') return;
    event.preventDefault();
    form.requestSubmit();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Player"
      // A form: only Save and Cancel close it, so a stray tap never loses what was typed.
      dismissible={false}
      footer={
        <>
          <Button type="submit" form={formId} size="lg" disabled={saving}>
            Save
          </Button>
          <Button variant="secondary" size="lg" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} noValidate onSubmit={handleSubmit}>
        <TextField
          label="Name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(undefined);
          }}
          onKeyDown={handleNameKeyDown}
          error={nameError}
          maxLength={TEXT_LIMITS.playerName}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="next"
        />
        <TextField
          ref={jerseyRef}
          label="Jersey number"
          hint="Optional"
          value={jerseyNumber}
          onChange={(event) => setJerseyNumber(event.target.value)}
          onKeyDown={handleJerseyKeyDown}
          maxLength={TEXT_LIMITS.jerseyNumber}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
        />
      </form>
    </Sheet>
  );
}
