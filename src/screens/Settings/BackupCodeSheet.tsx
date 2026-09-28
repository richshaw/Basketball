import { Fragment } from 'react';
import { Button } from '@/components/Button/Button';
import { CopyIcon, ShareIcon } from '@/components/Icons/Icons';
import { Sheet } from '@/components/Sheet/Sheet';
import { useToast } from '@/components/Toast/toastContext';
import { copyText, shareText } from '@/lib/share';
import { shareableCode } from './cloudBackupText';
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
  "Write it down or save it somewhere safe. It's the only way to get your stats onto a new phone, and nobody (not even us) can recover it.";

/**
 * The code's groups, each with the dash that follows it, on two lines so it's easy to
 * copy by hand: '7K3M-9QXA-B2CD-EF45-' then 'GH67-JK89-MN0P'.
 */
function codeLines(code: string): string[][] {
  const groups = code
    .split('-')
    .map((group, index, all) => (index < all.length - 1 ? `${group}-` : group));
  const half = Math.ceil(groups.length / 2);
  return [groups.slice(0, half), groups.slice(half)].filter((line) => line.length > 0);
}

/**
 * The backup code, large and monospaced, grouped the way the engine writes it, with
 * Copy and Share (to Notes, or to a partner) and why it matters. Just after turning
 * backup on, only "I've saved it" closes it.
 */
export function BackupCodeSheet({ open, code, reason, onClose }: BackupCodeSheetProps) {
  const toast = useToast();
  const justTurnedOn = reason !== 'show';

  const copy = async () => {
    const copied = await copyText(code);
    toast.show({
      message: copied ? 'Backup code copied' : "Couldn't copy the code. Write it down instead.",
    });
  };

  // Straight from the tap: the share sheet only opens right after one.
  const share = async () => {
    const result = await shareText({ title: 'Hoop Stats backup code', text: shareableCode(code) });
    if (result === 'copied') toast.show({ message: 'Backup code copied' });
    else if (result === 'failed') {
      toast.show({ message: "Couldn't share the code. Write it down instead." });
    }
  };

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
        <p className={styles.code}>
          {codeLines(code).map((line, lineIndex) => (
            <span key={lineIndex} className={styles.line}>
              {line.map((group, index) => (
                // A narrow screen may wrap a line, but only between groups.
                <Fragment key={index}>
                  <span className={styles.group}>{group}</span>
                  <wbr />
                </Fragment>
              ))}
            </span>
          ))}
        </p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={copy}>
            <CopyIcon className={styles.icon} />
            Copy
          </Button>
          <Button variant="secondary" onClick={share}>
            <ShareIcon className={styles.icon} />
            Share
          </Button>
        </div>
        <p className={styles.warning}>{KEEP_IT_SAFE}</p>
      </div>
    </Sheet>
  );
}
