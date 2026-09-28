/**
 * Test helpers for the court components. jsdom does no layout and has no DOMMatrix,
 * so an SVG's screen transform (getScreenCTM) is faked here.
 */

export interface ScreenTransform {
  /** Screen pixels per SVG unit. */
  scale: number;
  /** Where SVG (0, 0) is on screen, in client pixels. */
  originX: number;
  originY: number;
}

/** The part of a DOMMatrix that `clientToCourt` uses: a 2D transform and its inverse. */
function affine(a: number, b: number, c: number, d: number, e: number, f: number): DOMMatrix {
  return {
    a,
    b,
    c,
    d,
    e,
    f,
    inverse() {
      // Like DOMMatrix: a matrix with no inverse gives NaN or Infinity values.
      const det = a * d - b * c;
      return affine(
        d / det,
        -b / det,
        -c / det,
        a / det,
        (c * f - d * e) / det,
        (b * e - a * f) / det,
      );
    },
  } as unknown as DOMMatrix;
}

/** A fake screen transform: SVG units to client pixels. */
export function screenTransform({ scale, originX, originY }: ScreenTransform): DOMMatrix {
  return affine(scale, 0, 0, scale, originX, originY);
}

/** Makes `svg` report `transform` (or no transform, for null) as its getScreenCTM(). */
export function mockScreenCtm(svg: Element, transform: ScreenTransform | null): void {
  (svg as SVGSVGElement).getScreenCTM = () => (transform ? screenTransform(transform) : null);
}

/** Where an SVG position lands on screen under `transform`. */
export function svgToClient(
  { x, y }: { x: number; y: number },
  { scale, originX, originY }: ScreenTransform,
): { clientX: number; clientY: number } {
  return { clientX: originX + x * scale, clientY: originY + y * scale };
}
