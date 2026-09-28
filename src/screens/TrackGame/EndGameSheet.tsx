import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import { TextField } from '@/components/TextField/TextField';
import type { FinalScore } from '@/data/repo';
import type { NotSaved } from './session';
import { notSavedMessage, parseScore } from './tracking';
import styles from './EndGameSheet.module.css';

export interface EndGameSheetProps {
  open: boolean;
  /** Scores already saved on the game, to start from. */
  teamScore?: number;
  opponentScore?: number;
  /**
   * Ends the game with the scores that were typed (a blank one clears a saved score),
   * after saving every stat not saved yet, unless `anyway`. Resolves to the stats
   * still not saved (the game isn't ended then), or to null once it's ended. Rejects
   * if it couldn't be ended.
   */
  onEnd: (score: FinalScore, anyway: boolean) => Promise<NotSaved | null>;
  /** "Keep tracking": close without ending the game. */
  onClose: () => void;
}

const NUMBERS_ONLY = 'Use numbers only (0–999)';

/**
 * "Final score" form for ending the game. Only its own buttons close it, so a stray
 * tap can't lose what was typed. Mount it fresh (a new `key`) each time it opens.
 * If some stats aren't saved yet, it says so and stays open, offering to try again
 * or to end the game anyway (kept stats are saved later on their own).
 */
export function EndGameSheet({
  open,
  teamScore,
  opponentScore,
  onEnd,
  onClose,
}: EndGameSheetProps) {
  const formId = useId();
  const opponentRef = useRef<HTMLInputElement>(null);
  const [team, setTeam] = useState(teamScore?.toString() ?? '');
  const [opponent, setOpponent] = useState(opponentScore?.toString() ?? '');
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  // Stats that weren't saved when the game was about to end.
  const [notSaved, setNotSaved] = useState<NotSaved | null>(null);

  const parsedTeam = parseScore(team);
  const parsedOpponent = parseScore(opponent);

  const end = async (anyway: boolean) => {
    if (saving) return;
    if (parsedTeam === null || parsedOpponent === null) {
      setShowErrors(true);
      return;
    }
    // A blank field clears a score saved earlier (null), and leaves out one never set.
    const score: FinalScore = {};
    if (parsedTeam !== undefined) score.teamScore = parsedTeam;
    else if (teamScore !== undefined) score.teamScore = null;
    if (parsedOpponent !== undefined) score.opponentScore = parsedOpponent;
    else if (opponentScore !== undefined) score.opponentScore = null;
    setSaving(true);
    try {
      setNotSaved(await onEnd(score, anyway));
    } catch {
      // The caller has said what went wrong; let them try again.
    } finally {
      setSaving(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void end(false);
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
            {notSaved ? 'Try again' : 'End game'}
          </Button>
          {notSaved ? (
            <Button variant="secondary" size="lg" disabled={saving} onClick={() => void end(true)}>
              End anyway
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" onClick={onClose}>
            Keep tracking
          </Button>
        </>
      }
    >
      {notSaved ? (
        <p role="alert" className={styles.notSaved}>
          {notSavedMessage(notSaved.count, notSaved.kept)}
        </p>
      ) : null}
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
          onKeyDown={(event) => {
            // "next" on the keyboard: on to the other score, not ending the game with one.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            opponentRef.current?.focus();
          }}
          error={showErrors && parsedTeam === null ? NUMBERS_ONLY : undefined}
        />
        <TextField
          ref={opponentRef}
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
