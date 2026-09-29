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

export function CheckmarkIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.75} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
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

/** Safari's Share button: a box with an arrow coming out of the top. */
export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3v11.5" />
      <path d="M8 6.75 12 3l4 3.75" />
      <path d="M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5" />
    </Icon>
  );
}

/** Two overlapping pages: copy to the clipboard. */
export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </Icon>
  );
}

/** The outline of a cloud, shared by the cloud backup glyphs. */
const CLOUD_PATH = 'M7 19h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 6.62 10.4 4.3 4.3 0 0 0 7 19z';

/** Cloud backup, not backed up yet. */
export function CloudIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={CLOUD_PATH} />
    </Icon>
  );
}

/** Cloud backup, backed up. */
export function CloudCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={CLOUD_PATH} />
      <path d="M9.25 14.75l2 2 3.75-3.75" />
    </Icon>
  );
}

/** Cloud backup, waiting for a connection. */
export function CloudOffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d={CLOUD_PATH} />
      <path d="M4 4l16 16" />
    </Icon>
  );
}

/** Something needs the parent: an exclamation mark in a circle. */
export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.25" />
      <path d="M12 16.5h.01" strokeWidth={2.75} />
    </Icon>
  );
}

/** The share sheet's "Add to Home Screen" action: a plus in a rounded square. */
export function AddToHomeScreenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Icon>
  );
}
