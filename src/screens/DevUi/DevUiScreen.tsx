import { useId, useState, type ReactNode } from 'react';
import { Badge } from '@/components/Badge/Badge';
import { Button } from '@/components/Button/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { useConfirm } from '@/components/ConfirmDialog/confirmContext';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { InstallBannerView } from '@/components/InstallBanner/InstallBanner';
import { InstallSheet } from '@/components/InstallBanner/InstallSheet';
import { ScreenBody } from '@/components/ScreenBody/ScreenBody';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import { SegmentedControl } from '@/components/SegmentedControl/SegmentedControl';
import { Sheet } from '@/components/Sheet/Sheet';
import { StatTable } from '@/components/StatTable/StatTable';
import { StatTile, StatTileGrid } from '@/components/StatTile/StatTile';
import { TextArea, TextField } from '@/components/TextField/TextField';
import { useToast } from '@/components/Toast/toastContext';
import { shareText, type ShareResult } from '@/lib/share';
import { paths } from '@/routes';
import * as demo from './demoData';
import styles from './DevUiScreen.module.css';

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {note ? <p className={styles.note}>{note}</p> : null}
      {children}
    </section>
  );
}

const shareMessages: Record<Exclude<ShareResult, 'cancelled'>, string> = {
  shared: 'Shared',
  copied: 'Copied to clipboard',
  failed: "Couldn't share or copy",
};

type OpenSheet = 'editGame' | 'endGame' | 'opponents' | 'install' | null;

/**
 * Hidden gallery of the shared components in their main states, for reviews and
 * screenshots (`npm run screenshots`). Not linked from anywhere in the app.
 */
export function DevUiScreen() {
  const toast = useToast();
  const confirm = useConfirm();
  const [periodFormat, setPeriodFormat] = useState<demo.PeriodFormat>('quarters');
  const [venue, setVenue] = useState<demo.Venue>('home');
  const [filter, setFilter] = useState<demo.GameFilter>('all');
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  const [opponent, setOpponent] = useState('Tigers');
  const [lastAnswer, setLastAnswer] = useState('none yet');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [undos, setUndos] = useState(0);
  const periodsLabelId = useId();
  const closeSheet = () => setOpenSheet(null);

  const showMadeToast = () =>
    toast.show({
      message: '2PT made',
      actionLabel: 'Undo',
      onAction: () => {
        setUndos((count) => count + 1);
        toast.show({ message: 'Undone: 2PT made' });
      },
    });

  const deleteGame = async () => {
    const confirmed = await confirm({
      title: 'Delete this game?',
      message: 'Its stats will be gone for good.',
      confirmLabel: 'Delete game',
      destructive: true,
    });
    setLastAnswer(confirmed ? 'deleted' : 'kept');
    if (confirmed) toast.show({ message: 'Game deleted' });
  };

  // Two questions in a row: the second opens only once the first has gone.
  const archiveSeason = async () => {
    const archived = await confirm({
      title: 'Archive this season?',
      message: 'Its games move to Past seasons.',
      confirmLabel: 'Archive',
      cancelLabel: 'Not now',
    });
    if (!archived) {
      setLastAnswer('kept the season');
      return;
    }
    const deleted = await confirm({
      title: 'Delete its practice games too?',
      message: 'They will be gone for good.',
      confirmLabel: 'Delete practices',
      destructive: true,
    });
    setLastAnswer(deleted ? 'archived, deleted practices' : 'archived, kept practices');
  };

  const share = async () => {
    const result = await shareText({ title: 'Game vs Tigers', text: demo.gameSummary });
    if (result !== 'cancelled') toast.show({ message: shareMessages[result] });
  };

  return (
    <main>
      <ScreenHeader title="UI kit" backTo={paths.home} backLabel="Games" />
      <ScreenBody className={styles.body}>
        <p className={styles.note}>
          Every shared component in its main states. Nothing links here; open <code>#/dev/ui</code>{' '}
          directly.
        </p>

        <Section title="SegmentedControl" note="Radio group: arrow keys move the selection.">
          <div className={styles.field}>
            <span id={periodsLabelId} className={styles.label}>
              Periods
            </span>
            <SegmentedControl
              aria-labelledby={periodsLabelId}
              options={demo.periodFormats}
              value={periodFormat}
              onChange={setPeriodFormat}
            />
          </div>
          <SegmentedControl
            aria-label="Venue"
            size="lg"
            options={demo.venues}
            value={venue}
            onChange={setVenue}
          />
          <SegmentedControl
            aria-label="Show games"
            options={demo.gameFilters}
            value={filter}
            onChange={setFilter}
          />
        </Section>

        <Section title="TextField and TextArea">
          <TextField
            label="Opponent"
            hint="Pick a past opponent or type a new one"
            suggestions={demo.opponents}
            defaultValue="Tigers"
            autoComplete="off"
            enterKeyHint="next"
          />
          <div className={styles.pair}>
            <TextField label="Date" type="date" defaultValue="2026-09-26" />
            <TextField label="Our score" inputMode="numeric" defaultValue="42" />
          </div>
          <TextField label="Their score" inputMode="numeric" error="Enter a number" />
          <TextField label="Season" defaultValue="Fall 2026" disabled />
          <TextArea label="Notes" placeholder="Anything worth remembering" />
        </Section>

        <Section title="GroupedList and ListRow">
          <GroupedList header="Games" headingLevel={3}>
            <ListRow
              title={`vs ${opponent}`}
              subtitle="Sat, Sep 26 · Home"
              value={<Badge tone="accent">Live</Badge>}
              to={paths.trackGame('demo')}
            />
            <ListRow
              title="at Hawks"
              subtitle="Sat, Sep 19 · Away"
              value="W 42–38"
              to={paths.gameReport('demo')}
            />
            <ListRow
              title="vs Comets"
              subtitle="Sat, Sep 12 · Neutral"
              value="L 30–35"
              to={paths.gameReport('demo')}
            />
          </GroupedList>
          <GroupedList
            header="Backup"
            headingLevel={3}
            footer="Stats live only on this phone. Export a backup now and then."
          >
            <ListRow
              title="Export backup"
              icon="📤"
              onClick={() => toast.show({ message: 'Backup exported' })}
            />
            <ListRow title="Import backup" icon="📥" onClick={() => {}} disabled />
            <ListRow title="Version" icon="ℹ️" value="1.0.0" />
          </GroupedList>
          <GroupedList header="Danger zone" headingLevel={3}>
            <ListRow title="Delete this game" onClick={deleteGame} destructive />
          </GroupedList>
        </Section>

        <Section title="StatTable" note="Wide tables scroll sideways under a sticky first column.">
          <StatTable
            caption="Box score by quarter"
            columns={demo.boxScoreColumns}
            rows={demo.boxScoreRows}
            totalRow={demo.boxScoreTotal}
            highlightedRow={2}
          />
          <StatTable
            caption="Game log"
            columns={demo.gameLogColumns}
            rows={demo.gameLogRows}
            totalRow={demo.gameLogAverage}
          />
        </Section>

        <Section title="StatTile and StatTileGrid">
          <StatTileGrid aria-label="Game totals">
            <StatTile value={14} label="PTS" fullLabel="Points" detail="5/9 FG" highlight />
            <StatTile value={7} label="REB" fullLabel="Rebounds" detail="2 off" />
            <StatTile value={3} label="AST" fullLabel="Assists" />
            <StatTile value={2} label="STL" fullLabel="Steals" />
            <StatTile value={1} label="BLK" fullLabel="Blocks" />
            <StatTile value={3} label="TO" fullLabel="Turnovers" />
            <StatTile value="56%" label="FG%" fullLabel="Field goal percentage" detail="5/9" />
            <StatTile value="50%" label="FT%" fullLabel="Free throw percentage" detail="3/6" />
          </StatTileGrid>
          <StatTileGrid aria-label="Season averages" columns={3}>
            <StatTile value="11.8" label="PPG" fullLabel="Points per game" />
            <StatTile value="6.3" label="RPG" fullLabel="Rebounds per game" />
            <StatTile value="45.5%" label="FG%" fullLabel="Field goal percentage" />
          </StatTileGrid>
        </Section>

        <Section title="Badge">
          <div className={styles.row}>
            <Badge>Final</Badge>
            <Badge tone="accent">Live</Badge>
            <Badge tone="made">W</Badge>
            <Badge tone="miss">L</Badge>
            <Badge tone="stat">Home</Badge>
          </div>
        </Section>

        <Section title="Sheet and ConfirmDialog">
          <div className={styles.buttons}>
            <Button variant="secondary" onClick={() => setOpenSheet('editGame')}>
              Edit game
            </Button>
            <Button variant="secondary" onClick={() => setOpenSheet('endGame')}>
              Final score
            </Button>
            <Button variant="secondary" onClick={() => setOpenSheet('opponents')}>
              Pick opponent
            </Button>
            <Button variant="danger" onClick={deleteGame}>
              Delete game
            </Button>
            <Button variant="secondary" onClick={archiveSeason}>
              Archive season
            </Button>
          </div>
          <p className={styles.note} aria-live="polite">
            Last answer: {lastAnswer}
          </p>
        </Section>

        <Section title="Toast and shareText">
          <div className={styles.buttons}>
            <Button variant="secondary" onClick={showMadeToast}>
              2PT made
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                toast.show({
                  message: 'Saved. Your stats stay on this phone, even with no signal at all.',
                })
              }
            >
              Long toast
            </Button>
            <Button
              variant="secondary"
              onClick={() => toast.show({ message: 'Saved', placement: 'top' })}
            >
              Top toast
            </Button>
            <Button variant="secondary" onClick={share}>
              Share summary
            </Button>
          </div>
          <p className={styles.note}>Undos: {undos}</p>
        </Section>

        <Section
          title="InstallBanner and InstallSheet"
          note="Only in iPhone Safari, at the top of the tab screens; dismissed for 14 days."
        >
          <InstallBannerView
            onHow={() => setOpenSheet('install')}
            onDismiss={() => toast.show({ message: 'Banner dismissed' })}
          />
        </Section>

        <Section title="Button">
          <div className={styles.buttons}>
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <Button size="lg" block>
            Start game
          </Button>
        </Section>
      </ScreenBody>

      <Sheet
        open={openSheet === 'editGame'}
        onClose={closeSheet}
        title="Edit game"
        description="Changes are saved when you tap Save."
        footer={
          <>
            <Button
              size="lg"
              onClick={() => {
                closeSheet();
                toast.show({ message: 'Game saved' });
              }}
            >
              Save
            </Button>
            <Button variant="secondary" size="lg" onClick={closeSheet}>
              Cancel
            </Button>
          </>
        }
      >
        <div className={styles.stack}>
          <TextField label="Opponent" defaultValue={opponent} suggestions={demo.opponents} />
          <TextField label="Date" type="date" defaultValue="2026-09-26" />
          <SegmentedControl
            aria-label="Venue"
            options={demo.venues}
            value={venue}
            onChange={setVenue}
          />
          <Button variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Delete…
          </Button>
        </div>
        {/* A dialog inside a sheet: closing it must leave the sheet open. */}
        <ConfirmDialog
          open={confirmingDelete}
          title="Delete this game?"
          message="Its stats will be gone for good."
          confirmLabel="Delete game"
          destructive
          onConfirm={() => {
            setConfirmingDelete(false);
            closeSheet();
            toast.show({ message: 'Game deleted' });
          }}
          onCancel={() => setConfirmingDelete(false)}
        />
      </Sheet>

      <Sheet
        open={openSheet === 'endGame'}
        onClose={closeSheet}
        title="Final score"
        description="Only the buttons close this sheet (dismissible={false})."
        dismissible={false}
        footer={
          <>
            <Button size="lg" onClick={closeSheet}>
              End game
            </Button>
            <Button variant="secondary" size="lg" onClick={closeSheet}>
              Keep playing
            </Button>
          </>
        }
      >
        <div className={styles.pair}>
          <TextField label="Us" inputMode="numeric" defaultValue="42" />
          <TextField label="Them" inputMode="numeric" defaultValue="38" />
        </div>
      </Sheet>

      <Sheet open={openSheet === 'opponents'} onClose={closeSheet} title="Pick opponent">
        <Button
          variant="ghost"
          onClick={() => toast.show({ message: `Copied ${demo.manyOpponents.length} teams` })}
        >
          Copy list
        </Button>
        <GroupedList aria-label="Opponents">
          {demo.manyOpponents.map((team) => (
            <ListRow
              key={team}
              title={team}
              value={team === opponent ? 'Current' : undefined}
              onClick={() => {
                setOpponent(team);
                closeSheet();
              }}
            />
          ))}
        </GroupedList>
      </Sheet>

      <InstallSheet open={openSheet === 'install'} onClose={closeSheet} />
    </main>
  );
}
