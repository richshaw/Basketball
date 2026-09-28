import type { SVGProps } from 'react';

/**
 * Inline stroke icons on a 24x24 grid. They inherit `currentColor` and are hidden
 * from screen readers, so always pair them with visible text or an aria-label.
 */
export type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function BasketballIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18" />
      <path d="M5.64 5.64a9 9 0 0 1 0 12.72M18.36 5.64a9 9 0 0 0 0 12.72" />
    </Icon>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V5M17 16V9" strokeWidth={3} />
    </Icon>
  );
}

export function GearIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.4 4.78L10.75 2.48A9.6 9.6 0 0 1 13.25 2.48L13.6 4.78A7.4 7.4 0 0 1 15.98 5.76L17.84 4.38A9.6 9.6 0 0 1 19.62 6.16L18.24 8.02A7.4 7.4 0 0 1 19.22 10.4L21.52 10.75A9.6 9.6 0 0 1 21.52 13.25L19.22 13.6A7.4 7.4 0 0 1 18.24 15.98L19.62 17.84A9.6 9.6 0 0 1 17.84 19.62L15.98 18.24A7.4 7.4 0 0 1 13.6 19.22L13.25 21.52A9.6 9.6 0 0 1 10.75 21.52L10.4 19.22A7.4 7.4 0 0 1 8.02 18.24L6.16 19.62A9.6 9.6 0 0 1 4.38 17.84L5.76 15.98A7.4 7.4 0 0 1 4.78 13.6L2.48 13.25A9.6 9.6 0 0 1 2.48 10.75L4.78 10.4A7.4 7.4 0 0 1 5.76 8.02L4.38 6.16A9.6 9.6 0 0 1 6.16 4.38L8.02 5.76A7.4 7.4 0 0 1 10.4 4.78Z" />
      <circle cx="12" cy="12" r="2.75" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5l7 7-7 7" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}
