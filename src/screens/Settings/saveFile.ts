/**
 * Hands a file to the parent: the share sheet when the browser can share files (on
 * an iPhone: Save to Files, iCloud Drive, AirDrop, Mail…), else a download.
 */
import { shareFile } from '@/lib/share';

/**
 * - `shared`: the share sheet finished.
 * - `downloaded`: there was no way to share the file, so it was downloaded instead.
 * - `cancelled`: the parent closed the share sheet.
 * - `failed`: neither sharing nor downloading worked.
 */
export type SaveFileResult = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/** How long a download link's object URL lives: long enough for Safari to start reading it. */
const REVOKE_DOWNLOAD_URL_AFTER_MS = 60_000;

/**
 * Shares `file`, or downloads it where files can't be shared. Never throws.
 *
 * Browsers only open the share sheet right after a tap, so build the file first and
 * call this straight from the tap handler, with no `await` before it.
 */
export async function saveFile(file: File): Promise<SaveFileResult> {
  const shared = await shareFile(file);
  if (shared !== 'unavailable') return shared;
  // No file sharing here, or it failed (e.g. the tap was too long ago): download it.
  return downloadFile(file) ? 'downloaded' : 'failed';
}

/** Downloads `file` through a temporary `<a download>` link. Returns false if that failed. */
export function downloadFile(file: File): boolean {
  let url: string | undefined;
  try {
    url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  } catch {
    if (url) URL.revokeObjectURL(url);
    return false;
  }
  const objectUrl = url;
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_DOWNLOAD_URL_AFTER_MS);
  return true;
}
