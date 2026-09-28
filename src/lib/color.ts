/** WCAG 2.x color math, used to keep the design tokens accessible. */

/** Minimum contrast for normal-size text (WCAG AA). */
export const AA_TEXT_CONTRAST = 4.5;
/** Minimum contrast for large text and UI parts such as focus rings (WCAG AA). */
export const AA_UI_CONTRAST = 3;

/** Parses `#rgb` or `#rrggbb` into 0-255 channels. */
export function parseHexColor(hex: string): [number, number, number] {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) {
    throw new Error(`Not a hex color: ${hex}`);
  }
  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;
  return [0, 2, 4].map((start) => parseInt(full.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** Relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colors, from 1 (none) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
