import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Dark theme colors (keep in sync with src/styles/tokens.css and index.html).
const DARK_BACKGROUND = '#0b0d10';

/** package.json's version, or '' if it can't be read. */
function packageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    return typeof manifest.version === 'string' ? manifest.version : '';
  } catch {
    return '';
  }
}

/**
 * Short SHA of the commit being built. Falls back to CI's GITHUB_SHA, then to '' (a
 * build without git, e.g. from a source archive, still works).
 */
function commitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  }
}

export default defineConfig({
  // Relative base so the same build works at any sub-path
  // (e.g. https://richshaw.github.io/Basketball/) and from the service worker cache.
  base: './',
  // Build info shown in Settings > About (typed in src/global.d.ts).
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion()),
    __APP_COMMIT__: JSON.stringify(commitSha()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      // A new version waits until the user taps "Update" (see src/pwa/), so an
      // update never reloads the app in the middle of a game.
      registerType: 'prompt',
      // Registration happens in src/pwa/ServiceWorkerProvider.tsx via virtual:pwa-register/react.
      injectRegister: false,
      manifest: {
        name: 'Hoop Stats',
        short_name: 'Hoop Stats',
        description:
          'Record basketball stats with one tap during games, then review game and season reports.',
        lang: 'en',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        theme_color: DARK_BACKGROUND,
        background_color: DARK_BACKGROUND,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // The icons are already matched by the png glob below.
      includeManifestIcons: false,
      workbox: {
        // Precache everything the app needs so it works with no signal after the first load:
        // the build output and public/ files of these types. manifest.webmanifest is always
        // added by the plugin (so it isn't globbed again), and sw.js / workbox-*.js never are.
        globPatterns: ['**/*.{js,css,html,json,txt,svg,png,jpg,jpeg,webp,ico,woff,woff2}'],
        cleanupOutdatedCaches: true,
        // Let the first-installed worker control the already-open page right away.
        clientsClaim: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    alias: [
      // react-router/dom's CommonJS build require()s react-router, which Node resolves to
      // the ESM build while Vitest loads the CJS one: two router contexts, broken <Link>s.
      // Tests don't need its flushSync wiring, so use the main entry's RouterProvider.
      { find: /^react-router\/dom$/, replacement: 'react-router' },
    ],
    css: {
      // CSS is stubbed in tests, except `?raw` imports (tokens.test.ts reads the palette).
      include: [/\.css\?raw$/],
      // Plain class names (e.g. "primary") so tests can assert on them.
      modules: { classNameStrategy: 'non-scoped' },
    },
  },
});
