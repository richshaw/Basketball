import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/lib/cx';
import styles from './Switch.module.css';

export type SwitchProps = Omit<
  ComponentPropsWithRef<'button'>,
  'onChange' | 'role' | 'type' | 'aria-checked' | 'children'
> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * An iOS-style on/off switch: a button with role="switch" and aria-checked. Name it
 * with `aria-labelledby` (e.g. its row's title) or `aria-label`. The tap area is
 * 44px tall but overlaps its row's padding, so the row doesn't grow.
 */
export function Switch({ checked, onChange, className, ...props }: SwitchProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx(styles.switch, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
