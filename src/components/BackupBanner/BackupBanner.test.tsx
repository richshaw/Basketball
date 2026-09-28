import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { backUpNow } from '@/data/backup/cloudBackup';
import { paths } from '@/routes';
import { buildRealData, realGameId, REAL_LIVE_GAME_ID } from '@/test/backupHarness';
import {
  backUpFromAnotherPhone,
  pauseForAnotherPhone,
  pauseForMissingGames,
  seedOwnGames,
  settledStatus,
  setUpFakeCloudBackup,
  stopForDeletedCloudCopy,
  turnOnCloudBackup,
} from '@/test/cloudBackupApp';
import { renderRoute } from '@/test/render';
import { backupBannerReason } from './backupBannerReason';

const cloud = setUpFakeCloudBackup();

const banner = () => screen.queryByRole('complementary', { name: 'Cloud backup' });

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
    const code = await turnOnCloudBackup();
    await backUpFromAnotherPhone(cloud.server, code, buildRealData());
    await backUpNow();
    expect(await settledStatus()).toMatchObject({ state: 'paused-other-device' });

    // On a tab screen it shows...
    const games = renderRoute(paths.home);
    expect(
      await screen.findByRole('link', { name: 'Cloud backup is paused. Tap to fix' }),
    ).toBeVisible();
    games.unmount();

    // ...but never over a live game, or on any other full-screen route.
    for (const path of [
      paths.trackGame(REAL_LIVE_GAME_ID),
      paths.gameReport(realGameId(1)),
      paths.newGame,
      paths.restoreBackup(),
    ]) {
      const view = renderRoute(path);
      await waitFor(() => {
        expect(view.container).not.toBeEmptyDOMElement();
      });
      // Longer than the status takes to load on a tab screen.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(banner()).toBeNull();
      view.unmount();
    }
  });

  it("doesn't show while backup is fine, waiting for signal, or off", async () => {
    await seedOwnGames();
    await turnOnCloudBackup();
    const fine = renderRoute(paths.home);
    await screen.findByRole('heading', { level: 1, name: 'Games' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(banner()).toBeNull();
    fine.unmount();

    cloud.server.networkDown = true;
    await backUpNow();
    expect(await settledStatus()).toMatchObject({ state: 'waiting-for-signal' });
    renderRoute(paths.home);
    await screen.findByRole('heading', { level: 1, name: 'Games' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(banner()).toBeNull();
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
