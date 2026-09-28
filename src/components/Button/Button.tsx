import type { ComponentPropsWithRef } from 'react';
import { buttonClassName, type ButtonStyleProps } from './buttonClassName';

export type ButtonProps = ComponentPropsWithRef<'button'> & ButtonStyleProps;

/**
 * The app's button. Accepts every native button prop (including `ref`) and
 * defaults to `type="button"` so it never submits a form by accident.
 */
export function Button({
  variant,
  size,
  block,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, block }, className)}
      {...props}
    />
  );
}
