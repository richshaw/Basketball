/**
 * How the sample data's records are told apart from the parent's own: their fixed ids,
 * and the sample player just as the sample data makes her. Apart from demo.ts (which
 * makes the sample data and re-exports these), so an import or the cloud backup can
 * tell them apart without loading it.
 */
import type { Player } from './types';

export const DEMO_PLAYER_ID = 'demo-player';
export const DEMO_PLAYER_NAME = 'Ava';
export const DEMO_PLAYER_NUMBER = '12';
/** The optional live game's id (see `DemoOptions.liveGame`). */
export const DEMO_LIVE_GAME_ID = 'demo-live';

/** Id of the nth demo game, 1 (oldest) to 10 (newest), e.g. 'demo-game-10'. */
export function demoGameId(n: number): string {
  return `demo-game-${String(n).padStart(2, '0')}`;
}

/** Whether a game is demo data (e.g. to remove the sample games and nothing else). */
export function isDemoGameId(id: string): boolean {
  return id === DEMO_LIVE_GAME_ID || /^demo-game-\d{2}$/.test(id);
}

/** Whether `player` is the sample player just as the sample data made her: not renamed. */
export function isDemoPlayer(player: Pick<Player, 'id' | 'name' | 'jerseyNumber'>): boolean {
  return (
    player.id === DEMO_PLAYER_ID &&
    player.name === DEMO_PLAYER_NAME &&
    player.jerseyNumber === DEMO_PLAYER_NUMBER
  );
}
