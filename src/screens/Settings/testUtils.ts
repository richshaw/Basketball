/** Test helpers for the Settings screen's file sharing and downloads. Only tests import this. */
import { vi } from 'vitest';
import { stubProperties } from '@/components/InstallBanner/testing';

type Share = (data: ShareData) => Promise<void>;

/** A share sheet that can take files (like iOS Safari). Returns the `share` mock. */
export function stubFileSharing(share: Share = () => Promise.resolve()) {
  const shareMock = vi.fn(share);
  stubProperties(navigator, {
    share: shareMock,
    canShare: vi.fn((data: ShareData) => Array.isArray(data.files) && data.files.length > 0),
  });
  return shareMock;
}

export interface CapturedDownload {
  name: string;
  file: Blob | undefined;
}

/**
 * Records downloads started through an `<a download>` link instead of letting jsdom
 * try to navigate. Returns the list, which fills in as downloads happen.
 */
export function captureDownloads(): CapturedDownload[] {
  const downloads: CapturedDownload[] = [];
  const files = new Map<string, Blob>();
  stubProperties(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      const url = `blob:hoop-stats/${files.size + 1}`;
      files.set(url, blob);
      return url;
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ name: this.download, file: files.get(this.getAttribute('href') ?? '') });
  });
  return downloads;
}

/** The file passed to the first `navigator.share` call. */
export function sharedFile(share: ReturnType<typeof stubFileSharing>): File {
  const file = share.mock.calls[0]?.[0].files?.[0];
  if (!file) throw new Error('Nothing was shared');
  return file;
}
