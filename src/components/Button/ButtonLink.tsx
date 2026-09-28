import type { ComponentPropsWithRef } from 'react';
import { Link } from 'react-router';
import { buttonClassName, type ButtonStyleProps } from './buttonClassName';

export type ButtonLinkProps = ComponentPropsWithRef<typeof Link> & ButtonStyleProps;

/** A router link that looks like a Button. Use it when the action is navigation. */
export function ButtonLink({ variant, size, block, className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClassName({ variant, size, block }, className)} {...props} />;
}
