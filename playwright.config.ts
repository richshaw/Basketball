import { defineConfig } from '@playwright/test';

// Each worktree running e2e in parallel needs its own port: E2E_PORT=4174 npm run e2e.
const PORT = Number(process.env.E2E_PORT ?? 4173);
// Serve the build under a sub-path, like GitHub Pages does (richshaw.github.io/Basketball/),
// so any absolute URL that would break there fails here first.
const BASE_PATH = '/Basketball/';
const baseURL = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // An iPhone-sized Chromium. Playwright's iPhone device presets default to WebKit,
    // which isn't installed, so the device is described by hand.
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    trace: 'on-first-retry',
  },
  projects: [
    // `npm run e2e`: behavior tests.
    { name: 'e2e', testIgnore: /screenshots\.spec\.ts/ },
    // `npm run screenshots`: PNGs of each screen (tests tagged @screenshots).
    { name: 'screenshots', testMatch: /screenshots\.spec\.ts/ },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort --base ${BASE_PATH}`,
    url: baseURL,
    // Always test this checkout's fresh build, never a server someone else left running.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
