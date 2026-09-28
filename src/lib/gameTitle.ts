import type { Game } from '@/data/types';

/**
 * How a game is named everywhere: "vs Central", or "@ Central" for an away game.
 * Home, neutral and unknown venues all read "vs".
 */
export function gameTitle(game: Pick<Game, 'opponent' | 'homeAway'>): string {
  return `${game.homeAway === 'away' ? '@' : 'vs'} ${game.opponent}`;
}
