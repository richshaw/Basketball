import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button/Button';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/SegmentedControl/SegmentedControl';
import { Sheet } from '@/components/Sheet/Sheet';
import { TextArea, TextField } from '@/components/TextField/TextField';
import { useToast } from '@/components/Toast/toastContext';
import { useGames, useSeasons } from '@/data/hooks';
import { updateGame } from '@/data/repo';
import { TEXT_LIMITS, type Game } from '@/data/types';
import {
  gameFormFrom,
  validateGameForm,
  type GameForm,
  type GameFormErrors,
  type ScoreField,
  type Venue,
} from './gameForm';
import styles from './EditGameSheet.module.css';

const VENUES: readonly SegmentedOption<Venue>[] = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
  { value: 'neutral', label: 'Neutral' },
];

/** Fields in the order they appear, to focus the first one with a problem. */
const FIELD_ORDER = [
  'opponent',
  'date',
  'season',
  'teamScore',
  'opponentScore',
  'notes',
] as const satisfies readonly (keyof GameForm)[];

export interface EditGameSheetProps {
  game: Game;
  open: boolean;
  onClose: () => void;
  /** Start on this score field (opening the keyboard), e.g. from "Add score". */
  focusScore?: ScoreField;
}

/**
 * Edits a game's details: opponent, date, season, venue, final score and notes.
 * Nothing is saved until Save, and only Save or Cancel close it, so a stray tap
 * can't throw away what was typed. Mount it fresh (a new `key`) for each opening.
 */
export function EditGameSheet({ game, open, onClose, focusScore }: EditGameSheetProps) {
  const toast = useToast();
  const games = useGames();
  const seasons = useSeasons();
  const [form, setForm] = useState<GameForm>(() => gameFormFrom(game));
  const [errors, setErrors] = useState<GameFormErrors>({});
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const fieldIds = {
    opponent: useId(),
    date: useId(),
    season: useId(),
    teamScore: useId(),
    opponentScore: useId(),
    notes: useId(),
  };
  const venueLabelId = useId();
  const teamScoreRef = useRef<HTMLInputElement>(null);
  const opponentScoreRef = useRef<HTMLInputElement>(null);

  const opponents = games ? [...new Set(games.map((each) => each.opponent))] : undefined;

  const change =
    <K extends keyof GameForm>(key: K) =>
    (value: GameForm[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
      // Typing in a field clears its error; the rest wait for the next Save.
      if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
    };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const result = validateGameForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      const first = FIELD_ORDER.find((key) => result.errors[key]);
      if (first) document.getElementById(fieldIds[first])?.focus();
      return;
    }
    setSaving(true);
    try {
      await updateGame(game.id, result.patch);
      onClose();
      toast.show({ message: 'Changes saved' });
    } catch (error) {
      console.error('Saving the game failed', error);
      toast.show({ message: "Couldn't save the changes. Try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit game"
      dismissible={false}
      initialFocusRef={
        focusScore === 'teamScore'
          ? teamScoreRef
          : focusScore === 'opponentScore'
            ? opponentScoreRef
            : undefined
      }
      footer={
        <>
          <Button type="submit" form={formId} size="lg" disabled={saving}>
            Save
          </Button>
          <Button variant="secondary" size="lg" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} noValidate onSubmit={save}>
        <TextField
          id={fieldIds.opponent}
          label="Opponent"
          value={form.opponent}
          onChange={(event) => change('opponent')(event.target.value)}
          error={errors.opponent}
          suggestions={opponents}
          maxLength={TEXT_LIMITS.opponent}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          required
        />
        <TextField
          id={fieldIds.date}
          label="Date"
          type="date"
          value={form.date}
          onChange={(event) => change('date')(event.target.value)}
          error={errors.date}
          required
        />
        <TextField
          id={fieldIds.season}
          label="Season"
          placeholder="Optional, e.g. Fall 2026"
          value={form.season}
          onChange={(event) => change('season')(event.target.value)}
          error={errors.season}
          suggestions={seasons}
          maxLength={TEXT_LIMITS.season}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
        />
        <div className={styles.field}>
          <span id={venueLabelId} className={styles.label}>
            Home or away
          </span>
          <SegmentedControl
            aria-labelledby={venueLabelId}
            options={VENUES}
            value={form.venue}
            onChange={change('venue')}
          />
        </div>
        <div className={styles.pair}>
          <TextField
            ref={teamScoreRef}
            id={fieldIds.teamScore}
            label="Our score"
            value={form.teamScore}
            onChange={(event) => change('teamScore')(event.target.value)}
            error={errors.teamScore}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            autoComplete="off"
            enterKeyHint="done"
          />
          <TextField
            ref={opponentScoreRef}
            id={fieldIds.opponentScore}
            label="Their score"
            value={form.opponentScore}
            onChange={(event) => change('opponentScore')(event.target.value)}
            error={errors.opponentScore}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
        <TextArea
          id={fieldIds.notes}
          label="Notes"
          value={form.notes}
          onChange={(event) => change('notes')(event.target.value)}
          error={errors.notes}
          maxLength={TEXT_LIMITS.notes}
          placeholder="Anything worth remembering"
          rows={4}
        />
      </form>
    </Sheet>
  );
}
