import '@testing-library/jest-dom/vitest';
// In-memory IndexedDB for jsdom, so data-layer code can run in unit tests.
// (Must load before anything imports Dexie.)
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { stopCatchingSecondTaps } from '@/components/Sheet/secondTap';
import { stopReopeningDatabase } from '@/data/reopen';
import { disposeTrackingSessions } from '@/screens/TrackGame/session';
import { resetDatabase } from './db';
import { installDialogPolyfill } from './dialogPolyfill';

// jsdom can't open <dialog> elements (Sheet, ConfirmDialog) on its own. (Tests that run
// in Node instead, like src/data/backup/server.node.test.ts, have no DOM to patch.)
if (typeof HTMLDialogElement !== 'undefined') installDialogPolyfill();

// jsdom has no canvas (it would log "not implemented"): code that measures text with
// one falls back as it would in a browser without it.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', { value: () => null });
}

// Every test starts with an empty database (seed data in beforeEach, not beforeAll),
// and with nothing in localStorage (e.g. taps kept by src/data/pendingStats.ts).
beforeEach(async () => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  await resetDatabase();
});

afterEach(() => {
  // Vitest globals are off, so Testing Library can't register this itself.
  cleanup();
  // The live game screen's sessions outlive their screen (one per game, for the page):
  // stop them, so none of their taps, spots or retry timers (src/screens/TrackGame/
  // session.ts) carry into the next test, where a late retry could keep a tap or save
  // one. Before the timers are real again, so fake ones are cleared too.
  disposeTrackingSessions();
  // Nor may a try to open the database again (src/data/reopen.ts), after a test that
  // closed it for good.
  stopReopeningDatabase();
  // Nor a tap, nor the spot catching its second tap (src/components/Sheet/secondTap.ts).
  stopCatchingSecondTaps();
  // IndexedDB runs on real timers: never let one test's fake timers stall the next reset.
  vi.useRealTimers();
});
