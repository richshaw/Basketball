import { afterEach, describe, expect, it, vi } from 'vitest';
import { restoreStubs, stubProperties } from '@/components/InstallBanner/testing';
import { downloadFile, saveFile } from './saveFile';
import { captureDownloads, stubFileSharing } from './testUtils';

const backupFile = () =>
  new File(['{"app":"hoop-stats"}'], 'hoop-stats-backup-2026-09-28.json', {
    type: 'application/json',
  });

afterEach(() => {
  restoreStubs();
});

describe('saveFile', () => {
  it('opens the share sheet with just the file when files can be shared', async () => {
    const share = stubFileSharing();
    const downloads = captureDownloads();
    const file = backupFile();

    await expect(saveFile(file)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file] });
    expect(downloads).toEqual([]);
  });

  it('downloads the file when the browser has no share sheet', async () => {
    const downloads = captureDownloads();
    const file = backupFile();

    await expect(saveFile(file)).resolves.toBe('downloaded');
    expect(downloads).toEqual([{ name: 'hoop-stats-backup-2026-09-28.json', file }]);
    // The temporary link is gone again.
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('downloads when the share sheet cannot take files', async () => {
    const share = vi.fn(() => Promise.resolve());
    stubProperties(navigator, { share, canShare: () => false });
    const downloads = captureDownloads();

    await expect(saveFile(backupFile())).resolves.toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(downloads).toHaveLength(1);
  });

  it('downloads when there is a share sheet but no canShare to ask', async () => {
    stubProperties(navigator, { share: vi.fn(() => Promise.resolve()) });
    const downloads = captureDownloads();

    await expect(saveFile(backupFile())).resolves.toBe('downloaded');
    expect(downloads).toHaveLength(1);
  });

  it('does nothing more when the parent closes the share sheet', async () => {
    stubFileSharing(() => Promise.reject(new DOMException('Share canceled', 'AbortError')));
    const downloads = captureDownloads();

    await expect(saveFile(backupFile())).resolves.toBe('cancelled');
    expect(downloads).toEqual([]);
  });

  it('downloads instead when sharing fails for another reason', async () => {
    stubFileSharing(() => Promise.reject(new DOMException('No user gesture', 'NotAllowedError')));
    const downloads = captureDownloads();

    await expect(saveFile(backupFile())).resolves.toBe('downloaded');
    expect(downloads).toHaveLength(1);
  });

  it('reports a failure when neither works, without throwing', async () => {
    stubProperties(URL, {
      createObjectURL: () => {
        throw new Error('No object URLs here');
      },
    });

    await expect(saveFile(backupFile())).resolves.toBe('failed');
  });
});

describe('downloadFile', () => {
  it('frees the object URL a while after the download starts', () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    captureDownloads();
    const revokeObjectURL = vi.fn();
    stubProperties(URL, { revokeObjectURL });

    expect(downloadFile(backupFile())).toBe(true);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:hoop-stats/1');
  });
});
