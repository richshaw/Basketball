import type { seedDemoData } from '@/data/demo';
import type { clearAllData, exportAll } from '@/data/transfer';

declare global {
  interface Window {
    /**
     * Data helpers for the browser console, e2e tests and screenshots, installed by
     * src/main.tsx in every build (the app is local-only, so they expose nothing).
     */
    hoopStats?: {
      seedDemoData: typeof seedDemoData;
      clearAllData: typeof clearAllData;
      exportAll: typeof exportAll;
    };
  }
}

export {};
