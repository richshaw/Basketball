import type { SVGProps } from 'react';

/** A "+" drawn like the shared icons (24x24 stroke, currentColor). Decorative. */
export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
