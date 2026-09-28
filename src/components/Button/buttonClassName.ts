import { cx } from '@/lib/cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'lg';

export interface ButtonStyleProps {
  /** Defaults to `primary` (accent fill). Use one primary action per screen. */
  variant?: ButtonVariant;
  /** `md` is 44px tall (the minimum tap target); `lg` is 56px for main actions. */
  size?: ButtonSize;
  /** Stretch to the full width of the container. */
  block?: boolean;
}

/** Class names shared by Button and ButtonLink so both look identical. */
export function buttonClassName(
  { variant = 'primary', size = 'md', block = false }: ButtonStyleProps,
  className?: string,
): string {
  return cx(styles.button, styles[variant], styles[size], block && styles.block, className);
}
