/** Sharing and copying text (game summaries, backups). These never throw. */

/**
 * - `shared`: the share sheet finished.
 * - `cancelled`: the user closed the share sheet; nothing was copied.
 * - `copied`: there was no share sheet (or it failed), so the text was copied instead.
 * - `failed`: neither sharing nor copying worked.
 */
export type ShareResult = 'shared' | 'cancelled' | 'copied' | 'failed';

export interface ShareTextOptions {
  /** Used by some share targets, e.g. as an email subject. */
  title?: string;
  text: string;
}

/**
 * Opens the system share sheet (Web Share API) when the browser has one, and
 * otherwise copies `text` to the clipboard. Resolves to what happened; never rejects.
 *
 * Browsers only allow sharing and copying right after a tap, so prepare the text
 * first and call this directly from the tap handler.
 */
export async function shareText({ title, text }: ShareTextOptions): Promise<ShareResult> {
  const data: ShareData = title === undefined ? { text } : { title, text };

  if (canShare(data)) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      if (isAbortError(error)) return 'cancelled';
      // Any other failure (no recent tap, a share sheet already open, ...): copy instead.
    }
  }

  return (await copyText(text)) ? 'copied' : 'failed';
}

/** Copies `text` to the clipboard. Resolves to `false` instead of throwing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    // Missing outside secure contexts (http://), so check before using it.
    if (typeof navigator === 'undefined' || !('clipboard' in navigator)) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function canShare(data: ShareData): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    return typeof navigator.canShare === 'function' ? navigator.canShare(data) : true;
  } catch {
    return false;
  }
}

/** The user closed the share sheet (a DOMException named AbortError). */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}
