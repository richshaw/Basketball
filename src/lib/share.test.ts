import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, shareFile, shareText } from './share';

/** Replaces `navigator` with just the given APIs. */
function stubNavigator(apis: Record<string, unknown>) {
  vi.stubGlobal('navigator', apis);
}

const resolves = () => vi.fn(() => Promise.resolve());
const rejectsWith = (error: Error) => vi.fn(() => Promise.reject(error));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shareText', () => {
  it('opens the share sheet when the browser has one', async () => {
    const share = resolves();
    const writeText = resolves();
    stubNavigator({ share, canShare: () => true, clipboard: { writeText } });

    await expect(shareText({ title: 'vs Tigers', text: '14 PTS, 5/9 FG' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'vs Tigers', text: '14 PTS, 5/9 FG' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('leaves out a missing title', async () => {
    const share = resolves();
    stubNavigator({ share });

    await expect(shareText({ text: '14 PTS' })).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: '14 PTS' });
  });

  it('reports a closed share sheet as cancelled and copies nothing', async () => {
    const writeText = resolves();
    stubNavigator({
      share: rejectsWith(new DOMException('Share canceled', 'AbortError')),
      clipboard: { writeText },
    });

    await expect(shareText({ text: '14 PTS' })).resolves.toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies instead when the share sheet fails for another reason', async () => {
    const writeText = resolves();
    stubNavigator({
      share: rejectsWith(new DOMException('No user gesture', 'NotAllowedError')),
      clipboard: { writeText },
    });

    await expect(shareText({ text: '14 PTS' })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('14 PTS');
  });

  it('copies when there is no share sheet', async () => {
    const writeText = resolves();
    stubNavigator({ clipboard: { writeText } });

    await expect(shareText({ title: 'Backup', text: '{"games":[]}' })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('{"games":[]}');
  });

  it('copies when the share sheet cannot take this data', async () => {
    const share = resolves();
    const writeText = resolves();
    stubNavigator({ share, canShare: () => false, clipboard: { writeText } });

    await expect(shareText({ text: '14 PTS' })).resolves.toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('treats a canShare that throws as no share sheet', async () => {
    const share = resolves();
    stubNavigator({
      share,
      canShare: () => {
        throw new Error('canShare exploded');
      },
      clipboard: { writeText: resolves() },
    });

    await expect(shareText({ text: '14 PTS' })).resolves.toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('fails without throwing when sharing and copying both fail', async () => {
    stubNavigator({
      share: rejectsWith(new TypeError('Bad data')),
      clipboard: { writeText: rejectsWith(new DOMException('Denied', 'NotAllowedError')) },
    });

    await expect(shareText({ text: '14 PTS' })).resolves.toBe('failed');
  });

  it('fails without throwing when neither API exists', async () => {
    stubNavigator({});

    await expect(shareText({ text: '14 PTS' })).resolves.toBe('failed');
  });
});

describe('shareFile', () => {
  const file = () => new File(['{}'], 'hoop-stats-backup-2026-09-28.json');

  it('shares just the file when the share sheet takes files', async () => {
    const share = resolves();
    stubNavigator({ share, canShare: () => true });
    const backup = file();

    await expect(shareFile(backup)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [backup] });
  });

  it('is unavailable where the share sheet cannot take files, or cannot say', async () => {
    const share = resolves();
    stubNavigator({ share, canShare: () => false });
    await expect(shareFile(file())).resolves.toBe('unavailable');

    // No canShare: an older share sheet, for text only.
    stubNavigator({ share });
    await expect(shareFile(file())).resolves.toBe('unavailable');
    stubNavigator({});
    await expect(shareFile(file())).resolves.toBe('unavailable');
    expect(share).not.toHaveBeenCalled();
  });

  it('reports a closed share sheet as cancelled', async () => {
    stubNavigator({
      share: rejectsWith(new DOMException('Share canceled', 'AbortError')),
      canShare: () => true,
    });
    await expect(shareFile(file())).resolves.toBe('cancelled');
  });

  it('is unavailable when the share sheet fails for another reason', async () => {
    stubNavigator({
      share: rejectsWith(new DOMException('No user gesture', 'NotAllowedError')),
      canShare: () => true,
    });
    await expect(shareFile(file())).resolves.toBe('unavailable');
  });
});

describe('copyText', () => {
  it('copies to the clipboard', async () => {
    const writeText = resolves();
    stubNavigator({ clipboard: { writeText } });

    await expect(copyText('Hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('Hello');
  });

  it('resolves to false when copying is not allowed', async () => {
    stubNavigator({ clipboard: { writeText: rejectsWith(new Error('Denied')) } });

    await expect(copyText('Hello')).resolves.toBe(false);
  });
});
