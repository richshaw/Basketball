import type { GamesSummary } from '@/data/stats';
import type { Player } from '@/data/types';
import { formatAvg, formatPct, formatPlayerName } from '@/lib/format';
import { formatRecord } from './gameLabels';

/** What a season recap is called when it covers every game rather than one season. */
export const ALL_GAMES_LABEL = 'All games';

/**
 * A short, plain-text season recap to share, e.g.
 *
 * ```text
 * Ava — Fall 2026 (8–2)
 * 12.4 PPG · 5.1 RPG · 2.3 APG · 1.8 SPG
 * FG 44% · 3PT 31% · FT 68%
 * ```
 *
 * `seasonLabel` null means all games. The record is left out when no game has a final
 * score, and a shooting split when there were no attempts.
 */
export function buildSeasonRecap(
  player: Pick<Player, 'name'> | null | undefined,
  seasonLabel: string | null,
  summary: Pick<GamesSummary, 'record' | 'averages' | 'shooting'>,
): string {
  const record = formatRecord(summary.record);
  const heading = `${formatPlayerName(player)} — ${seasonLabel ?? ALL_GAMES_LABEL}${
    record ? ` (${record})` : ''
  }`;

  const { averages, shooting } = summary;
  const perGame = [
    `${formatAvg(averages.pts)} PPG`,
    `${formatAvg(averages.reb)} RPG`,
    `${formatAvg(averages.ast)} APG`,
    `${formatAvg(averages.stl)} SPG`,
  ].join(' · ');

  const splits = (
    [
      ['FG', shooting.fgPct],
      ['3PT', shooting.fg3Pct],
      ['FT', shooting.ftPct],
    ] as const
  )
    .filter(([, pct]) => pct !== null)
    .map(([label, pct]) => `${label} ${formatPct(pct)}`)
    .join(' · ');

  return [heading, perGame, splits].filter(Boolean).join('\n');
}
