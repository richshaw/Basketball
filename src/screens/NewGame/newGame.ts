/**
 * Pure helpers for the new game form: its defaults and suggestions.
 */
import type { Game, HomeAway } from '@/data/types';

/**
 * A new game starts as a home game. Home and neutral games both read "vs Central", so
 * when nobody changes it the game is at worst called home instead of neutral; an away
 * default would label every forgotten home game "@ Central".
 */
export const DEFAULT_HOME_AWAY: HomeAway = 'home';

/** An example season for the empty field, e.g. 'Fall 2026' in October 2026. */
export function exampleSeason(today: string): string {
  const [year = '', month = '1'] = today.split('-');
  // Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall.
  const names = ['Winter', 'Spring', 'Summer', 'Fall'] as const;
  const name = names[Math.floor((Number(month) % 12) / 3)] ?? 'Fall';
  return `${name} ${year}`;
}

/**
 * Each team played so far, once, most recent first (pass games newest first).
 * Spellings that differ only in case count as one team; the latest spelling wins.
 */
export function pastOpponents(games: readonly Pick<Game, 'opponent'>[]): string[] {
  const seen = new Map<string, string>();
  for (const { opponent } of games) {
    const name = opponent.trim();
    const key = name.toLocaleLowerCase();
    if (name && !seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()];
}
