import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/**
 * Generates the favicon and app icons in public/ from public/icon.svg.
 * Run `npm run generate-pwa-assets` after changing the SVG, then commit the output.
 *
 * icon.svg is already full-bleed (dark background, ball inside the maskable safe
 * zone), so no extra padding is added: the iOS icon has no transparency.
 */
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // Full-color PNGs: the default 256-color palette dithers the gradients.
    png: { compressionLevel: 9, palette: false },
    transparent: { ...minimal2023Preset.transparent, padding: 0 },
    maskable: { ...minimal2023Preset.maskable, padding: 0 },
    apple: { ...minimal2023Preset.apple, padding: 0 },
  },
  images: ['public/icon.svg'],
});
