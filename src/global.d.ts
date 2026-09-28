import type { cloudBackupConsole } from '@/data/backup/cloudBackup';
import type { seedDemoData } from '@/data/demo';
import type { clearAllData, exportAll } from '@/data/transfer';

declare global {
  /** package.json's version, set at build time by vite.config.ts (`define`); may be ''. */
  const __APP_VERSION__: string;
  /** Short git SHA of the build, set at build time by vite.config.ts; '' without git. */
  const __APP_COMMIT__: string;

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
