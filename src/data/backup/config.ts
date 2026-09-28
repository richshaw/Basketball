/**
 * Where the backup server is: `VITE_BACKUP_API_URL`, set when the app is built
 * (see .github/workflows/deploy.yml). Without it the build has no cloud backup.
 */

/** The backup server's base URL without a trailing slash, or undefined if not set up. */
export function backupApiUrl(): string | undefined {
  // Read on each call (not at import), so tests can stub it with vi.stubEnv.
  const configured = import.meta.env.VITE_BACKUP_API_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.href.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}
