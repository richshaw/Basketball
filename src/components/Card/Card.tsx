import type { ComponentPropsWithRef } from 'react';
import { cx } from '@/lib/cx';
import styles from './Card.module.css';

export type CardProps = ComponentPropsWithRef<'div'>;

/** A rounded surface that groups related content. */
export function Card({ className, ...props }: CardProps) {
  return <div className={cx(styles.card, className)} {...props} />;
}
