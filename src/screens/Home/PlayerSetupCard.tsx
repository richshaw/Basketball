import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import { useToast } from '@/components/Toast/toastContext';
import { savePlayer, type PlayerInput } from '@/data/repo';
import { TEXT_LIMITS, type Player } from '@/data/types';
import { paths } from '@/routes';
import styles from './PlayerSetupCard.module.css';

export interface PlayerSetupCardProps {
  /** The player so far: null before there is one, or one with no name yet. */
  player: Player | null;
}

/**
 * First run: asks who's being tracked before anything else. Games can still be
 * started without it; the name can be added any time later. Once the player has a
 * name, Games stops showing the card.
 */
export function PlayerSetupCard({ player }: PlayerSetupCardProps) {
  const toast = useToast();
  const headingId = useId();
  const [name, setName] = useState(player?.name ?? '');
  const [jerseyNumber, setJerseyNumber] = useState(player?.jerseyNumber ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const jerseyRef = useRef<HTMLInputElement>(null);

  const nameError = showErrors && !name.trim() ? 'Enter a name' : undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    setShowErrors(true);
    const trimmedName = name.trim();
    if (!trimmedName) {
      nameRef.current?.focus();
      return;
    }

    // Send a jersey number only when one was typed (or to clear one that was there).
    const input: PlayerInput = { name: trimmedName };
    const trimmedNumber = jerseyNumber.trim();
    if (trimmedNumber) input.jerseyNumber = trimmedNumber;
    else if (player?.jerseyNumber) input.jerseyNumber = null;

    savingRef.current = true;
    setSaving(true);
    try {
      await savePlayer(input);
    } catch (error) {
      console.error('Saving the player failed', error);
      toast.show({ message: 'Couldn’t save the name. Please try again.' });
      savingRef.current = false;
      setSaving(false);
    }
  };

  // The name's return key moves on to the jersey number instead of saving.
  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    jerseyRef.current?.focus();
  };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.intro}>
        <span className={styles.icon} aria-hidden="true">
          🏀
        </span>
        <h2 id={headingId} className={styles.title}>
          Who are you tracking?
        </h2>
        <p className={styles.message}>
          Add your player’s name and number. They go on every game report.
        </p>
      </div>

      <form className={styles.form} noValidate onSubmit={handleSubmit}>
        <div className={styles.fields}>
          <TextField
            ref={nameRef}
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={handleNameKeyDown}
            error={nameError}
            required
            maxLength={TEXT_LIMITS.playerName}
            autoComplete="off"
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            className={styles.name}
          />
          <TextField
            ref={jerseyRef}
            label="Number"
            value={jerseyNumber}
            onChange={(event) => setJerseyNumber(event.target.value)}
            placeholder="Optional"
            maxLength={TEXT_LIMITS.jerseyNumber}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="done"
            className={styles.number}
          />
        </div>
        <Button type="submit" size="lg" block disabled={saving}>
          Save
        </Button>
      </form>

      <p className={styles.restore}>
        Restoring from a backup?{' '}
        <Link to={paths.settings} className={styles.restoreLink}>
          Go to Settings
        </Link>
      </p>
    </section>
  );
}
