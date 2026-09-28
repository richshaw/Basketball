import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/lib/cx';
import styles from './ScreenBody.module.css';

/**
 * A screen's content column, below its ScreenHeader: page padding and a readable
 * max width. On full-screen routes it also clears the home indicator; inside
 * AppShell the tab bar already does.
 */
export function ScreenBody({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cx(styles.body, className)} {...props} />;
}
