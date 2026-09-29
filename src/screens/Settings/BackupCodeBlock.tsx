import { Fragment } from 'react';
import { Button } from '@/components/Button/Button';
import { CopyIcon, ShareIcon } from '@/components/Icons/Icons';
import { useToast } from '@/components/Toast/toastContext';
import { cx } from '@/lib/cx';
import { copyText, shareText } from '@/lib/share';
import { shareableCode } from './cloudBackupText';
import styles from './BackupCodeBlock.module.css';

export interface BackupCodeBlockProps {
  code: string;
  /** `lg` (default) where the code is the point (BackupCodeSheet); `md` as a side note. */
  size?: 'lg' | 'md';
}

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
 * A backup code, monospaced and grouped the way the engine writes it, with Copy and
 * Share (to Notes, or to a partner). Say next to it why it matters.
 */
export function BackupCodeBlock({ code, size = 'lg' }: BackupCodeBlockProps) {
  const toast = useToast();

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
    <div className={styles.block}>
      <p className={cx(styles.code, styles[size])}>
        {codeLines(code).map((line, lineIndex) => (
          <span key={lineIndex}>
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
    </div>
  );
}
