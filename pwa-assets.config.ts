import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/** Background of the full-bleed icons: the dark theme's surface color. */
const ICON_TILE = '#16191e';

/**
 * Generates the favicon and app icons in public/ from public/icon.svg (the ball on a
 * transparent background). Run `npm run generate-pwa-assets` after changing the SVG,
 * then commit the output.
 *
 * - favicon.ico and pwa-*.png ("any" purpose): the ball alone, on transparency.
 * - maskable-icon-512x512.png: the ball at 70% on a full-bleed tile, inside the 80%
 *   circle that Android masks may keep.
 * - apple-touch-icon-180x180.png: the same tile. iOS rounds the corners itself and
 *   shows transparent pixels as black, so this icon is fully opaque.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Full-color PNGs: the default 256-color palette dithers the gradient.
    png: { compressionLevel: 9, palette: false },
    maskable: {
      ...minimal2023Preset.maskable,
      padding: 0.3,
      resizeOptions: { fit: 'contain', background: ICON_TILE },
    },
    apple: {
      ...minimal2023Preset.apple,
      padding: 0.3,
      resizeOptions: { fit: 'contain', background: ICON_TILE },
    },
  },
  images: ['public/icon.svg'],
});
