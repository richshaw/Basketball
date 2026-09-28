import { useId, useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/Button/Button';
import { ButtonLink } from '@/components/Button/ButtonLink';
import { ShotMap } from '@/components/Court/ShotMap';
import { ShotZoneSummary } from '@/components/Court/ShotZoneSummary';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { StatTile, StatTileGrid } from '@/components/StatTile/StatTile';
import { useToast } from '@/components/Toast/toastContext';
import { useAllEvents, useGames, useLiveGame, usePlayer, useSettings } from '@/data/hooks';
import { shotChartSection, shotsFromEvents } from '@/data/shots';
import { statLinesForGames, summarizeGames, type GamesSummary } from '@/data/stats';
import type { Game, Player } from '@/data/types';
import { formatAvg, formatMadeAttempted, formatPct, formatPlayerName } from '@/lib/format';
import { shareText } from '@/lib/share';
import { paths } from '@/routes';
import { GameLog } from './GameLog';
import { formatGameCount, formatRecord, spansYears } from './gameLabels';
import { SeasonHighs } from './SeasonHighs';
import { SeasonPicker } from './SeasonPicker';
import { ALL_GAMES_LABEL, buildSeasonRecap } from './seasonRecap';
import {
  inSeason,
  readRememberedSeason,
  rememberSeason,
  resolveSeasonKey,
  seasonLabels,
  seasonOf,
  type SeasonKey,
} from './seasonFilter';
import { TotalsTable } from './TotalsTable';
import { TrendChart } from './TrendChart';
import styles from './SeasonStatsScreen.module.css';

interface SectionProps {
  title: string;
  /** The heading's id, e.g. for something in the section to be named by it. */
  headingId?: string;
  children: ReactNode;
}

function Section({ title, headingId: givenHeadingId, children }: SectionProps) {
  const generatedHeadingId = useId();
  const headingId = givenHeadingId ?? generatedHeadingId;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.sectionTitle}>
        {title}
      </h2>
      {children}
    </section>
  );
}

interface SummaryCardProps {
  player: Player | null;
  /** 'Fall 2026 · 10 games' */
  caption: string;
  record: GamesSummary['record'];
}

/** Whose stats these are, over which games, and the team's record in them. */
function SummaryCard({ player, caption, record }: SummaryCardProps) {
  const name = formatPlayerName(player);
  const jersey = player?.jerseyNumber;
  const recordText = formatRecord(record);
  return (
    <div className={styles.summary}>
      <div className={styles.avatar} aria-hidden="true">
        {jersey ?? name.charAt(0).toUpperCase()}
      </div>
      <div className={styles.identity}>
        <p className={styles.playerName}>
          {name}
          {jersey ? <span className="visually-hidden">, number {jersey}</span> : null}
        </p>
        <p className={styles.summaryCaption}>{caption}</p>
      </div>
      {recordText ? (
        <dl className={styles.record}>
          <dt className={styles.recordLabel}>Record</dt>
          <dd className={styles.recordValue}>{recordText}</dd>
        </dl>
      ) : null}
    </div>
  );
}

function Averages({ summary }: { summary: GamesSummary }) {
  const { averages: avg, shooting, totals } = summary;
  return (
    <StatTileGrid aria-label="Averages per game" columns={3}>
      <StatTile value={formatAvg(avg.pts)} label="PPG" fullLabel="Points per game" highlight />
      <StatTile value={formatAvg(avg.reb)} label="RPG" fullLabel="Rebounds per game" />
      <StatTile value={formatAvg(avg.ast)} label="APG" fullLabel="Assists per game" />
      <StatTile value={formatAvg(avg.stl)} label="SPG" fullLabel="Steals per game" />
      <StatTile value={formatAvg(avg.blk)} label="BPG" fullLabel="Blocks per game" />
      <StatTile value={formatAvg(avg.tov)} label="TO/G" fullLabel="Turnovers per game" />
      <StatTile
        value={formatPct(shooting.fgPct)}
        label="FG%"
        fullLabel="Field goal percentage"
        detail={formatMadeAttempted(totals.fgm, totals.fga)}
      />
      <StatTile
        value={formatPct(shooting.fg3Pct)}
        label="3P%"
        fullLabel="Three-point percentage"
        detail={formatMadeAttempted(totals.fg3m, totals.fg3a)}
      />
      <StatTile
        value={formatPct(shooting.ftPct)}
        label="FT%"
        fullLabel="Free throw percentage"
        detail={formatMadeAttempted(totals.ftm, totals.fta)}
      />
    </StatTileGrid>
  );
}

/** Says which in-progress games the numbers leave out. */
function liveGamesNote(liveGames: readonly Game[]): string | null {
  const [only] = liveGames;
  if (!only) return null;
  if (liveGames.length === 1) {
    return `The game against ${only.opponent} is still in progress. It counts once it’s final.`;
  }
  return `${liveGames.length} games still in progress aren’t counted until they’re final.`;
}

function NoGamesYet({ liveGame }: { liveGame: Game | null }) {
  return liveGame ? (
    <EmptyState
      icon="📊"
      title="No finished games yet"
      message={`The game against ${liveGame.opponent} is still going. Its stats show up here once it’s final.`}
      action={
        <ButtonLink to={paths.trackGame(liveGame.id)} size="lg">
          Back to the game
        </ButtonLink>
      }
    />
  ) : (
    <EmptyState
      icon="📊"
      title="No stats yet"
      message="Finish a game and the averages, highs, trends and game log all show up here."
      action={
        <ButtonLink to={paths.newGame} size="lg">
          Start a game
        </ButtonLink>
      }
    />
  );
}

/**
 * Season stats: the record, per-game averages, highs, a game-by-game chart, totals
 * and the game log, for one season or all of them. Only final games count.
 */
export function SeasonStatsScreen() {
  const games = useGames();
  const events = useAllEvents();
  const player = usePlayer();
  // The game "Back to the game" opens: the same one the Games screen offers to resume.
  const liveGame = useLiveGame();
  const settings = useSettings();
  const toast = useToast();
  const [remembered, setRemembered] = useState(readRememberedSeason);
  const shotChartHeadingId = useId();

  // Season labels, most recent first (what useSeasons() reads, without a second query).
  const seasons = useMemo(() => games && seasonLabels(games), [games]);
  const finalGames = useMemo(() => games?.filter((game) => game.status === 'final'), [games]);
  // Stat lines for every final game, newest first (the order of useGames).
  const allEntries = useMemo(
    () => (finalGames && events ? statLinesForGames(finalGames, events) : undefined),
    [finalGames, events],
  );
  const key: SeasonKey | undefined =
    finalGames && seasons ? resolveSeasonKey(remembered, seasons, finalGames) : undefined;
  // Everything below is recomputed only when the games, their stats or the season change.
  const entries = useMemo(
    () => (key ? allEntries?.filter((entry) => inSeason(entry.game, key)) : undefined),
    [allEntries, key],
  );
  const summary = useMemo(() => entries && summarizeGames(entries), [entries]);
  const oldestFirst = useMemo(() => entries && [...entries].reverse(), [entries]);
  const gamesById = useMemo(
    () => new Map(entries?.map((entry) => [entry.game.id, entry.game])),
    [entries],
  );
  // Games from more than one year (e.g. all seasons): every date shows its year.
  const withYear = useMemo(() => spansYears(entries?.map((entry) => entry.game) ?? []), [entries]);
  // Every 2PT/3PT attempt in the games shown, for the shot chart.
  const shots = useMemo(() => {
    if (!entries || !events) return undefined;
    const shown = new Set(entries.map((entry) => entry.game.id));
    return shotsFromEvents(events.filter((event) => shown.has(event.gameId)));
  }, [entries, events]);

  const chooseSeason = (next: SeasonKey) => {
    setRemembered(next);
    rememberSeason(next);
  };

  const ready =
    games &&
    seasons &&
    player !== undefined &&
    liveGame !== undefined &&
    settings &&
    key &&
    entries &&
    summary &&
    oldestFirst &&
    shots;
  const season = key ? seasonOf(key) : null;
  // What the numbers cover: the season, or every game ("All seasons" once there are some).
  const scopeLabel = season ?? (seasons?.length ? 'All seasons' : ALL_GAMES_LABEL);
  const hasStats = Boolean(ready && entries.length > 0);

  const share = async () => {
    if (!summary) return;
    const result = await shareText({
      title: `${formatPlayerName(player)} — ${scopeLabel}`,
      text: buildSeasonRecap(player, scopeLabel, summary),
    });
    if (result === 'copied') toast.show({ message: 'Copied' });
    else if (result === 'failed') toast.show({ message: 'Couldn’t share or copy the recap' });
  };

  let content: ReactNode = null;
  if (ready) {
    const liveInView = games.filter((game) => game.status === 'live' && inSeason(game, key));
    const note = liveGamesNote(liveInView);
    // With no season labels at all, "All games · 10 games" would say it twice.
    const caption =
      seasons.length > 0
        ? `${scopeLabel} · ${formatGameCount(summary.gamesPlayed)}`
        : formatGameCount(summary.gamesPlayed);
    const shotChart = shotChartSection(shots, settings.shotChart);

    content =
      finalGames?.length === 0 ? (
        <NoGamesYet liveGame={liveGame} />
      ) : (
        <>
          <div className={styles.top}>
            {seasons.length > 0 ? (
              <SeasonPicker seasons={seasons} value={key} onChange={chooseSeason} />
            ) : null}
            {entries.length > 0 ? (
              <SummaryCard player={player} caption={caption} record={summary.record} />
            ) : null}
            {note ? <p className={styles.footnote}>{note}</p> : null}
          </div>

          {entries.length === 0 ? (
            <EmptyState
              icon="🗓️"
              title={`No finished games in ${season ?? 'this season'} yet`}
              message="Only finished games count toward stats."
            />
          ) : (
            <>
              <Section title="Averages">
                <Averages summary={summary} />
              </Section>

              <SeasonHighs
                title={season ? 'Season highs' : 'Career highs'}
                highs={summary.highs}
                games={gamesById}
                withYear={withYear}
              />

              <Section title="Game by game">
                {/* A new season starts the chart afresh: no game still selected from the last. */}
                <TrendChart
                  key={key}
                  entries={oldestFirst}
                  averages={summary.averages}
                  withYear={withYear}
                />
              </Section>

              <Section title="Totals">
                <TotalsTable label={scopeLabel} summary={summary} />
              </Section>

              <Section title="Game log">
                <GameLog entries={entries} withYear={withYear} />
              </Section>

              {shotChart ? (
                <Section title="Shot chart" headingId={shotChartHeadingId}>
                  {shotChart === 'map' ? (
                    <>
                      {/* Named by the section's heading and the caption, as on the game report. */}
                      <ShotMap
                        shots={shots}
                        aria-labelledby={shotChartHeadingId}
                        caption={<span className={styles.shotMapCaption}>{caption}</span>}
                      />
                      <ShotZoneSummary shots={shots} />
                    </>
                  ) : (
                    <p className={styles.footnote}>No shot spots were recorded for these games.</p>
                  )}
                </Section>
              ) : null}
            </>
          )}
        </>
      );
  }

  return (
    <main>
      <ScreenHeader
        title="Stats"
        action={
          hasStats ? (
            <Button variant="ghost" onClick={share}>
              Share
            </Button>
          ) : undefined
        }
      />
      {/* Busy until the data is read (the content shows all at once, then). */}
      <ScreenBody className={styles.body} aria-busy={ready ? undefined : true}>
        {content}
      </ScreenBody>
    </main>
  );
}
