import '@testing-library/jest-dom/vitest';
// In-memory IndexedDB for jsdom, so data-layer code can run in unit tests.
// (Must load before anything imports Dexie.)
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetDatabase } from './db';
import { installDialogPolyfill } from './dialogPolyfill';

// jsdom can't open <dialog> elements (Sheet, ConfirmDialog) on its own.
installDialogPolyfill();

// jsdom has no canvas (it would log "not implemented"): code that measures text with
// one falls back as it would in a browser without it.
Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });

// Every test starts with an empty database (seed data in beforeEach, not beforeAll).
beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  // Vitest globals are off, so Testing Library can't register this itself.
  cleanup();
  // IndexedDB runs on real timers: never let one test's fake timers stall the next reset.
  vi.useRealTimers();
});
