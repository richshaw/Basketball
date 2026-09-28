import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import { TextField } from '@/components/TextField/TextField';
import type { FinalScore } from '@/data/repo';
import { parseScore } from './tracking';
import styles from './EndGameSheet.module.css';

export interface EndGameSheetProps {
  open: boolean;
  /** Scores already saved on the game, to start from. */
  teamScore?: number;
  opponentScore?: number;
  /**
   * Ends the game with the scores that were typed (a blank one is left out, so the
   * saved value is kept). Resolves once it's done; rejects if it couldn't be saved.
   */
  onEnd: (score: FinalScore) => Promise<void>;
  /** "Keep tracking": close without ending the game. */
  onClose: () => void;
}

const NUMBERS_ONLY = 'Use numbers only (0–999)';

/**
 * "Final score" form for ending the game. Only its own buttons close it, so a stray
 * tap can't lose what was typed. Mount it fresh (a new `key`) each time it opens.
 */
export function EndGameSheet({
  open,
  teamScore,
  opponentScore,
  onEnd,
  onClose,
}: EndGameSheetProps) {
  const formId = useId();
  const [team, setTeam] = useState(teamScore?.toString() ?? '');
  const [opponent, setOpponent] = useState(opponentScore?.toString() ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsedTeam = parseScore(team);
  const parsedOpponent = parseScore(opponent);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (parsedTeam === null || parsedOpponent === null) {
      setShowErrors(true);
      return;
    }
    const score: FinalScore = {};
    if (parsedTeam !== undefined) score.teamScore = parsedTeam;
    if (parsedOpponent !== undefined) score.opponentScore = parsedOpponent;
    setSaving(true);
    try {
      await onEnd(score);
    } catch {
      // The caller has said what went wrong; let them try again.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Final score"
      description="Leave a score blank if you don't know it."
      dismissible={false}
      footer={
        <>
          <Button type="submit" form={formId} size="lg" disabled={saving}>
            End game
          </Button>
          <Button variant="secondary" size="lg" onClick={onClose}>
            Keep tracking
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form} noValidate onSubmit={submit}>
        <TextField
          label="Our team"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          autoComplete="off"
          enterKeyHint="next"
          value={team}
          onChange={(event) => setTeam(event.target.value)}
          error={showErrors && parsedTeam === null ? NUMBERS_ONLY : undefined}
        />
        <TextField
          label="Opponent"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          autoComplete="off"
          enterKeyHint="done"
          value={opponent}
          onChange={(event) => setOpponent(event.target.value)}
          error={showErrors && parsedOpponent === null ? NUMBERS_ONLY : undefined}
        />
      </form>
    </Sheet>
  );
}
