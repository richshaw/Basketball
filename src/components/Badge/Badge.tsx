import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/lib/cx';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'made' | 'miss' | 'stat';

export type BadgeProps = ComponentPropsWithRef<'span'> & {
  /** Fill color. `neutral` (default) is gray; the others use the stat fills. */
  tone?: BadgeTone;
};

/** A small pill label, e.g. "Live" or "W" next to a game in a list. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return <span className={cx(styles.badge, styles[tone], className)} {...props} />;
}
