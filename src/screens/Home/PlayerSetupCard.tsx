import {
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import { useToast } from '@/components/Toast/toastContext';
import { savePlayer, type PlayerInput } from '@/data/repo';
import { TEXT_LIMITS, type Player } from '@/data/types';
import styles from './PlayerSetupCard.module.css';

/** What the Games screen can ask the setup card. */
export interface PlayerSetupCardHandle {
  /**
   * What's typed on the card but not saved yet, as savePlayer's input (a number typed
   * on its own too), or null when nothing new is typed.
   */
  unsavedPlayer(): PlayerInput | null;
}

export interface PlayerSetupCardProps {
  /** The player so far: null before there is one, or one with no name yet. */
  player: Player | null;
  /**
   * `primary` (default) when saving is the screen's main action; `secondary` when
   * something else is, e.g. resuming a live game.
   */
  saveVariant?: 'primary' | 'secondary';
  /** "Try it with sample data" (FirstRunLinks) saves what's typed here first, through it. */
  ref?: Ref<PlayerSetupCardHandle>;
}

/**
 * What saving stores for the typed name and number: the name, and the number when one
 * is typed, or a clear of the saved one when its field was emptied.
 */
function playerInput(name: string, jerseyNumber: string, player: Player | null): PlayerInput {
  const input: PlayerInput = { name: name.trim() };
  const trimmedNumber = jerseyNumber.trim();
  if (trimmedNumber) input.jerseyNumber = trimmedNumber;
  else if (player?.jerseyNumber) input.jerseyNumber = null;
  return input;
}

/**
 * First run: asks who's being tracked before anything else. Games can still be
 * started without it; the name can be added any time later. Once the player has a
 * name, Games stops showing the card. Compact, so New game fits under it on an iPhone
 * SE, even below Safari's "Add to Home Screen" banner (the ways to restore a backup or
 * try sample data are under New game: FirstRunLinks, whose sample data first saves
 * what's typed here, through `ref`).
 */
export function PlayerSetupCard({ player, saveVariant = 'primary', ref }: PlayerSetupCardProps) {
  const toast = useToast();
  const headingId = useId();
  const [name, setName] = useState(player?.name ?? '');
  const [jerseyNumber, setJerseyNumber] = useState(player?.jerseyNumber ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const jerseyRef = useRef<HTMLInputElement>(null);

  // (The card shows only while the player has no name, so a typed name is always new.)
  useImperativeHandle(
    ref,
    () => ({
      unsavedPlayer: () =>
        name.trim() || jerseyNumber.trim() !== (player?.jerseyNumber ?? '')
          ? playerInput(name, jerseyNumber, player)
          : null,
    }),
    [name, jerseyNumber, player],
  );

  const nameError = showErrors && !name.trim() ? 'Enter a name' : undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    setShowErrors(true);
    if (!name.trim()) {
      nameRef.current?.focus();
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      await savePlayer(playerInput(name, jerseyNumber, player));
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
        <Button type="submit" size="lg" block variant={saveVariant} disabled={saving}>
          Save
        </Button>
      </form>
    </section>
  );
}
