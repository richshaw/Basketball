import '@testing-library/jest-dom/vitest';
// In-memory IndexedDB for jsdom, so data-layer code can run in unit tests.
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library can't register this itself.
afterEach(() => {
  cleanup();
});
