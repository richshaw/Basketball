import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBackupRuntime,
  getCloudBackupStatus,
  setBackupTimingsForTests,
  startBackupScheduler,
  stopBackupScheduler,
  subscribeToBackupRuntime,
  whenBackupIdle,
  type CloudBackupStatus,
} from '@/data/backup/cloudBackup';
import { useCloudBackupStatus } from '@/data/backup/hooks';
import { DEFAULT_TIMINGS } from '@/data/backup/policy';
import { savePlayer } from '@/data/repo';
import { paths } from '@/routes';
import { realGameId, REAL_LIVE_GAME_ID } from '@/test/backupHarness';
import {
  pauseForAnotherPhone,
  pauseForMissingGames,
  seedOwnGames,
  settledStatus,
  setUpFakeCloudBackup,
  stopForDeletedCloudCopy,
} from '@/test/cloudBackupApp';
import { renderRoute } from '@/test/render';
import { backupBannerReason } from './backupBannerReason';
import type * as BackupHooksModule from '@/data/backup/hooks';

// The real status, unless a test sets one (so a banner that doesn't show is certain
// not to, rather than still loading).
vi.mock('@/data/backup/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof BackupHooksModule>();
  return { ...actual, useCloudBackupStatus: vi.fn(actual.useCloudBackupStatus) };
});

const cloud = setUpFakeCloudBackup();

const banner = () => screen.queryByRole('complementary', { name: 'Cloud backup' });
const pausedBanner = () => screen.getByRole('link', { name: 'Cloud backup is paused. Tap to fix' });

const on = (status: Partial<CloudBackupStatus>): CloudBackupStatus => ({
  available: true,
  enabled: true,
  state: 'idle',
  pendingChanges: false,
  lastSuccessAt: Date.now(),
  ...status,
});
const PAUSED = on({ state: 'paused-shrink', shrink: { backedUpGames: 10, missingGames: 10 } });

afterEach(() => {
  // Back to the real status.
  vi.mocked(useCloudBackupStatus).mockReset();
});

describe('BackupBanner', () => {
  it('shows on every tab screen while backup is paused, and leads to the fix', async () => {
    await pauseForMissingGames();

    for (const path of [paths.home, paths.stats]) {
      const view = renderRoute(path);
      expect(
        await screen.findByRole('link', { name: 'Cloud backup is paused. Tap to fix' }),
      ).toBeVisible();
      view.unmount();
    }

    const { user, router } = renderRoute(paths.settings);
    await user.click(
      await screen.findByRole('link', { name: 'Cloud backup is paused. Tap to fix' }),
    );
    expect(router.state.location.pathname).toBe(paths.settings);
    expect(router.state.location.search).toBe('?section=cloud-backup');
  });

  it('pauses the same way when another phone backs up with the code', async () => {
    await pauseForAnotherPhone(cloud.server);
    renderRoute(paths.home);
    expect(
      await screen.findByRole('link', { name: 'Cloud backup is paused. Tap to fix' }),
    ).toBeVisible();
  });

  it('says backup has stopped when it needs the parent to act', async () => {
    await stopForDeletedCloudCopy(cloud.server);
    renderRoute(paths.home);
    expect(
      await screen.findByRole('link', { name: 'Cloud backup has stopped. Tap to fix' }),
    ).toBeVisible();
  });

  it('never shows on the live game screen or any other full-screen route', async () => {
    await seedOwnGames({ liveGame: true });
    vi.mocked(useCloudBackupStatus).mockReturnValue(PAUSED);

    // On a tab screen it shows at once...
    const games = renderRoute(paths.home);
    expect(pausedBanner()).toBeVisible();
    games.unmount();

    // ...but never over a live game, or on any other full-screen route: they're outside
    // the tab screens' shell (no tab bar), the only place it lives.
    for (const path of [
      paths.trackGame(REAL_LIVE_GAME_ID),
      paths.gameReport(realGameId(1)),
      paths.newGame,
      paths.restoreBackup(),
    ]) {
      const view = renderRoute(path);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
      expect(banner()).toBeNull();
      view.unmount();
    }
  });

  it.each<[string, CloudBackupStatus]>([
    ['backed up', on({})],
    ['backing up', on({ state: 'backing-up' })],
    ['waiting for signal', on({ state: 'waiting-for-signal', pendingChanges: true })],
    ['retrying later', on({ state: 'error', nextAttemptAt: Date.now() + 60_000 })],
    ['off', { available: true, enabled: false, state: 'idle', pendingChanges: false }],
  ])("doesn't show while %s", async (_, status) => {
    vi.mocked(useCloudBackupStatus).mockReturnValue(status);
    renderRoute(paths.home);
    await screen.findByRole('heading', { level: 1, name: 'Games' });
    expect(banner()).toBeNull();
  });

  it('stays put while an automatic attempt checks the pause again', async () => {
    await pauseForMissingGames();
    expect(await settledStatus()).toMatchObject({ state: 'paused-shrink' });
    renderRoute(paths.settings);
    await screen.findByRole('heading', { level: 2, name: 'Player' });
    await screen.findByRole('link', { name: 'Cloud backup is paused. Tap to fix' });

    // Everything the banner and the paused rows show while the scheduler runs.
    const seen = new Set<string>();
    const look = () => {
      const anyway = screen.queryByRole('button', { name: /^Back up anyway/ });
      seen.add(`${banner() ? 'banner' : 'no banner'}, ${anyway ? 'anyway' : 'no anyway'}`);
    };
    const observer = new MutationObserver(look);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const uploading: boolean[] = [];
    const unsubscribe = subscribeToBackupRuntime(() =>
      uploading.push(getBackupRuntime().uploading),
    );

    // A change (the parent names the player), then the real scheduler: its first check
    // tries to back up, and the shrink guard holds it back again.
    await savePlayer({ name: 'Maya' });
    setBackupTimingsForTests({ startupDelayMs: 0, minIntervalMs: 0 });
    startBackupScheduler();
    try {
      await waitFor(() => {
        expect(uploading).toEqual([true, false]);
      });
      await whenBackupIdle();
    } finally {
      stopBackupScheduler();
      setBackupTimingsForTests({ ...DEFAULT_TIMINGS });
      unsubscribe();
      observer.disconnect();
    }

    look();
    expect([...seen]).toEqual(['banner, anyway']);
    expect(await getCloudBackupStatus()).toMatchObject({ state: 'paused-shrink' });
    expect(cloud.server.uploads).toHaveLength(1);
  });
});

describe('backupBannerReason', () => {
  const status = { available: true, enabled: true, pendingChanges: false } as const;

  it('asks for the parent only when backup is paused or stopped', () => {
    expect(backupBannerReason(undefined)).toBeNull();
    expect(backupBannerReason({ ...status, state: 'paused-shrink' })).toBe('paused');
    expect(backupBannerReason({ ...status, state: 'paused-other-device' })).toBe('paused');
    expect(backupBannerReason({ ...status, state: 'needs-attention' })).toBe('stopped');
    for (const state of ['idle', 'backing-up', 'waiting-for-signal', 'error'] as const) {
      expect(backupBannerReason({ ...status, state })).toBeNull();
    }
    expect(backupBannerReason({ ...status, enabled: false, state: 'paused-shrink' })).toBeNull();
  });
});
