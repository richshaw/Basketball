// Global styles first so component CSS modules come later in the cascade.
import './styles/tokens.css';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { seedDemoData } from '@/data/demo';
import { requestPersistentStorage } from '@/data/persistence';
import { clearAllData, exportAll } from '@/data/transfer';
import { App } from './App';

// Ask the browser not to evict the stats under storage pressure (never throws).
void requestPersistentStorage();

// Console, e2e and screenshot helpers (typed in src/global.d.ts).
window.hoopStats = { seedDemoData, clearAllData, exportAll };

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
