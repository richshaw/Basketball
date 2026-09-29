import { Button } from '@/components/Button/Button';
import { Sheet } from '@/components/Sheet/Sheet';
import { BackupCodeBlock } from './BackupCodeBlock';
import styles from './BackupCodeSheet.module.css';

/**
 * Why the code is on screen:
 * - `new`: cloud backup was just turned on with a new code;
 * - `reused`: it was turned on again with the code this phone kept;
 * - `show`: the parent asked to see it ("Show backup code").
 */
export type BackupCodeReason = 'new' | 'reused' | 'show';

export interface BackupCodeSheetProps {
  open: boolean;
  code: string;
  reason: BackupCodeReason;
  onClose: () => void;
}

const DESCRIPTIONS: Partial<Record<BackupCodeReason, string>> = {
  new: 'Cloud backup is on.',
  reused: 'Cloud backup is on again, with the same code as before.',
};

const KEEP_IT_SAFE =
  "Write it down or save it somewhere safe. It's the only way to restore your online backup, and nobody (not even us) can recover it.";

/**
 * The backup code, large and monospaced, grouped the way the engine writes it, with
 * Copy and Share (to Notes, or to a partner) and why it matters. Just after turning
 * backup on, only "I've saved it" closes it.
 */
export function BackupCodeSheet({ open, code, reason, onClose }: BackupCodeSheetProps) {
  const justTurnedOn = reason !== 'show';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={justTurnedOn ? 'Save your backup code' : 'Your backup code'}
      description={DESCRIPTIONS[reason]}
      // Just turned on: a stray tap on the page mustn't skip saving the code.
      dismissible={!justTurnedOn}
      footer={
        <Button size="lg" onClick={onClose}>
          {justTurnedOn ? "I've saved it" : 'Done'}
        </Button>
      }
    >
      <div className={styles.content}>
        <BackupCodeBlock code={code} />
        <p className={styles.warning}>{KEEP_IT_SAFE}</p>
      </div>
    </Sheet>
  );
}
