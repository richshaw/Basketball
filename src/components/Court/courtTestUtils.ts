/**
 * Test helpers for the court components. jsdom does no layout, so an SVG's box on
 * screen (getBoundingClientRect) is faked here.
 */
import { COURT_VIEW_BOX, type SvgPoint, type ViewBox } from './courtGeometry';

/** Where a court drawing is on screen: its view box at `scale` px per unit, from (left, top). */
export interface CourtPlacement {
  scale: number;
  left: number;
  top: number;
  /** The drawing's view box; the whole half court by default. */
  viewBox?: ViewBox;
}

/** A box on screen, in client pixels. */
export interface ScreenBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A DOMRect for `box` (jsdom has no DOMRect constructor). */
export function domRect({ left, top, width, height }: ScreenBox): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({ left, top, width, height }),
  };
}

/** The box a court drawing placed like this takes up on screen. */
export function courtBox({
  scale,
  left,
  top,
  viewBox = COURT_VIEW_BOX,
}: CourtPlacement): ScreenBox {
  return { left, top, width: viewBox.width * scale, height: viewBox.height * scale };
}

/** Makes `element` report `box` as its place on screen. */
export function mockScreenBox(element: Element, box: ScreenBox): void {
  element.getBoundingClientRect = () => domRect(box);
}

/** Where an SVG position lands on screen, for a court drawing placed like this. */
export function svgToClient(
  { x, y }: SvgPoint,
  { scale, left, top, viewBox = COURT_VIEW_BOX }: CourtPlacement,
): { clientX: number; clientY: number } {
  return { clientX: left + (x - viewBox.x) * scale, clientY: top + (y - viewBox.y) * scale };
}
