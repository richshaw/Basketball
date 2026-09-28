/**
 * Hands a file to the parent: the share sheet when the browser can share files (on
 * an iPhone: Save to Files, iCloud Drive, AirDrop, Mail…), else a download.
 */

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
  if (canShareFile(file)) {
    try {
      // Files only: with a title or text too, iOS saves an extra text file next to it.
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (isAbortError(error)) return 'cancelled';
      // Anything else (e.g. the tap was too long ago): download it instead.
    }
  }
  return downloadFile(file) ? 'downloaded' : 'failed';
}

function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** The parent closed the share sheet (a DOMException named AbortError). */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
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
