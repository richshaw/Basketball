import type { cloudBackupConsole } from '@/data/backup/cloudBackup';
import type { seedDemoData } from '@/data/demo';
import type { clearAllData, exportAll } from '@/data/transfer';

declare global {
  interface ImportMetaEnv {
    /**
     * The backup server's base URL (server/), e.g. https://richshaw-hoop-stats.fly.dev,
     * set when building (see .github/workflows/deploy.yml). Unset: no cloud backup.
     */
    readonly VITE_BACKUP_API_URL?: string;
  }

  interface Window {
    /**
     * Data helpers for the browser console, e2e tests and screenshots, installed by
     * src/main.tsx in every build (the app is local-only, so they expose nothing).
     */
    hoopStats?: {
      seedDemoData: typeof seedDemoData;
      clearAllData: typeof clearAllData;
      exportAll: typeof exportAll;
      /** The cloud backup's public API (src/data/backup/cloudBackup.ts). */
      backup: typeof cloudBackupConsole;
    };
  }
}

export {};
