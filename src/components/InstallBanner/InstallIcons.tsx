import type { SVGProps } from 'react';

/*
 * The iOS glyphs the install steps point at, drawn like src/components/Icons/Icons.tsx
 * (24x24 strokes in currentColor, hidden from screen readers). Kept here while other
 * screens are being built in parallel; move them into Icons.tsx when convenient.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps) {
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

/** Safari's Share button: a box with an arrow coming out of the top. */
export function ShareIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3v11.5" />
      <path d="M8 6.75 12 3l4 3.75" />
      <path d="M8.5 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1.5" />
    </Glyph>
  );
}

/** The share sheet's "Add to Home Screen" action: a plus in a rounded square. */
export function AddToHomeScreenIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Glyph>
  );
}
