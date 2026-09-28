import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/Button/Button';
import {
  SegmentedControl,
  type SegmentedOption,
} from '@/components/SegmentedControl/SegmentedControl';
import { TextField } from '@/components/TextField/TextField';
import { useToast } from '@/components/Toast/toastContext';
import { createGame } from '@/data/repo';
import {
  TEXT_LIMITS,
  type Game,
  type HomeAway,
  type PeriodFormat,
  type Settings,
} from '@/data/types';
import { isLocalISODate, todayLocalISO } from '@/lib/format';
import { paths } from '@/routes';
import { DEFAULT_HOME_AWAY, exampleSeason } from './newGame';
import styles from './NewGameForm.module.css';

const HOME_AWAY_OPTIONS: readonly SegmentedOption<HomeAway>[] = [
  { value: 'home', label: 'Home' },
  { value: 'away', label: 'Away' },
  { value: 'neutral', label: 'Neutral' },
];

const PERIOD_OPTIONS: readonly SegmentedOption<PeriodFormat>[] = [
  { value: 'quarters', label: 'Quarters' },
  { value: 'halves', label: 'Halves' },
];

export interface NewGameFormProps {
  /** Remembered from the last game: the season and the period format. */
  settings: Settings;
  /** Past opponents, most recent first, offered while typing. */
  opponents: readonly string[];
  /** Past seasons, most recent first. */
  seasons: readonly string[];
}

/** Opponent (required), date, venue, season and periods, then Start game. */
export function NewGameForm({ settings, opponents, seasons }: NewGameFormProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const homeAwayLabelId = useId();
  const periodsLabelId = useId();
  const [today] = useState(() => todayLocalISO());
  const [opponent, setOpponent] = useState('');
  const [date, setDate] = useState(today);
  const [homeAway, setHomeAway] = useState<HomeAway>(DEFAULT_HOME_AWAY);
  const [season, setSeason] = useState(settings.lastSeason ?? '');
  const [periodFormat, setPeriodFormat] = useState<PeriodFormat>(settings.defaultPeriodFormat);
  // Errors show after the first try to start, then update while typing.
  const [showErrors, setShowErrors] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);
  const opponentRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const errors = {
    opponent: opponent.trim() ? undefined : 'Enter the other team’s name',
    date: isLocalISODate(date) ? undefined : 'Pick the date of the game',
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // A second tap while the game is being created must not start two games.
    if (startingRef.current) return;
    setShowErrors(true);
    if (errors.opponent) {
      opponentRef.current?.focus();
      return;
    }
    if (errors.date) {
      dateRef.current?.focus();
      return;
    }

    startingRef.current = true;
    setStarting(true);
    let game: Game;
    try {
      game = await createGame({ opponent, date, season, homeAway, periodFormat });
    } catch (error) {
      console.error('Starting the game failed', error);
      toast.show({ message: 'Couldn’t start the game. Please try again.' });
      startingRef.current = false;
      setStarting(false);
      return;
    }
    // Replace this form in the history: going back from the game lands on Games.
    await navigate(paths.trackGame(game.id), { replace: true });
  };

  // Return closes the keyboard rather than starting the game, so the rest of the form
  // (and the Start button) come back into view first.
  const closeKeyboardOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  return (
    <form className={styles.form} noValidate onSubmit={handleSubmit}>
      <TextField
        ref={opponentRef}
        label="Opponent"
        value={opponent}
        onChange={(event) => setOpponent(event.target.value)}
        onKeyDown={closeKeyboardOnEnter}
        error={showErrors ? errors.opponent : undefined}
        suggestions={opponents}
        placeholder="Team name"
        required
        maxLength={TEXT_LIMITS.opponent}
        autoComplete="off"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
      />
      <TextField
        ref={dateRef}
        label="Date"
        type="date"
        value={date}
        onChange={(event) => setDate(event.target.value)}
        error={showErrors ? errors.date : undefined}
        required
      />
      <div className={styles.choice}>
        <span id={homeAwayLabelId} className={styles.choiceLabel}>
          Home or away
        </span>
        <SegmentedControl
          aria-labelledby={homeAwayLabelId}
          options={HOME_AWAY_OPTIONS}
          value={homeAway}
          onChange={setHomeAway}
        />
      </div>
      <TextField
        label="Season or team"
        hint="Optional. Keeps each season’s stats together."
        value={season}
        onChange={(event) => setSeason(event.target.value)}
        onKeyDown={closeKeyboardOnEnter}
        suggestions={seasons}
        placeholder={`e.g. ${exampleSeason(today)}`}
        maxLength={TEXT_LIMITS.season}
        autoComplete="off"
        autoCapitalize="words"
        // An autocorrected label would quietly start a separate season.
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
      />
      <div className={styles.choice}>
        <span id={periodsLabelId} className={styles.choiceLabel}>
          Periods
        </span>
        <SegmentedControl
          aria-labelledby={periodsLabelId}
          options={PERIOD_OPTIONS}
          value={periodFormat}
          onChange={setPeriodFormat}
        />
      </div>
      <Button type="submit" size="lg" block disabled={starting} className={styles.start}>
        Start game
      </Button>
    </form>
  );
}
