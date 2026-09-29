// Global styles first so component CSS modules come later in the cascade.
import './styles/tokens.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { cloudBackupConsole, startBackupScheduler } from '@/data/backup/cloudBackup';
import { seedDemoData } from '@/data/demo';
import { startPendingStatsRetry } from '@/data/pendingSaves';
import { requestPersistentStorage } from '@/data/persistence';
import { clearAllData, exportAll } from '@/data/transfer';
import { App } from './App';

// Ask the browser not to evict the stats under storage pressure (never throws).
void requestPersistentStorage();

// Console, e2e and screenshot helpers (typed in src/global.d.ts).
window.hoopStats = { seedDemoData, clearAllData, exportAll, backup: cloudBackupConsole };

// Automatic cloud backup, once it's turned on. Returns at once; all work happens later.
startBackupScheduler();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Stats (and shot spots) not saved yet (see src/data/pendingSaves.ts): those an earlier
// page kept but couldn't save before it closed are saved now, and any whose save fails
// is tried again while the app is open, whatever screen is showing. Nothing waits on
// it, and it never shows anything: the saved stats simply appear.
startPendingStatsRetry();
