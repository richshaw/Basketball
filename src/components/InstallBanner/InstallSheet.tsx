import type { ReactNode } from 'react';
import { GroupedList } from '@/components/GroupedList/GroupedList';
import { ListRow } from '@/components/GroupedList/ListRow';
import { Sheet } from '@/components/Sheet/Sheet';
import { AddToHomeScreenIcon, ShareIcon } from '@/components/Icons/Icons';
import { useGames } from '@/data/hooks';
import { APP_ICON_URL, isIosDevice } from './install';
import styles from './InstallSheet.module.css';

export interface InstallSheetProps {
  open: boolean;
  onClose: () => void;
}

function StepNumber({ children }: { children: ReactNode }) {
  return <span className={styles.stepNumber}>{children}</span>;
}

/** Home Screen apps don't see Safari's data, so games recorded in Safari need moving. */
function InstallFirstTip() {
  // Only read while the sheet is open (Sheet renders its content only then).
  const gameCount = useGames()?.length ?? 0;
  let subtitle =
    "The Home Screen app keeps its own data, apart from Safari's, so games recorded here won't show up there.";
  if (gameCount > 0) {
    const games = gameCount === 1 ? 'the game' : `the ${gameCount} games`;
    subtitle = `The Home Screen app keeps its own data, apart from Safari's. To move ${games} recorded here, save a backup file in Settings, then restore it in the app.`;
  }
  return <ListRow icon="☝️" title="Add it before you start tracking" subtitle={subtitle} />;
}

/**
 * How to add Hoop Stats to the iPhone Home Screen, and why it matters. Opened from
 * the install banner and from Settings.
 */
export function InstallSheet({ open, onClose }: InstallSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add to Home Screen"
      description="Hoop Stats works best as an app on your Home Screen."
    >
      <div className={styles.content}>
        <GroupedList header="In Safari" headingLevel={3}>
          <ListRow
            icon={<StepNumber>1</StepNumber>}
            title={
              <>
                Tap the Share button <ShareIcon className={styles.glyph} />
              </>
            }
            subtitle="Don't see it? Tap ••• first."
          />
          <ListRow
            icon={<StepNumber>2</StepNumber>}
            title={
              <>
                Tap <strong>Add to Home Screen</strong>{' '}
                <AddToHomeScreenIcon className={styles.glyph} />
              </>
            }
            subtitle="Scroll down the list if it isn't showing."
          />
          <ListRow
            icon={<StepNumber>3</StepNumber>}
            title={
              <>
                Tap <strong>Add</strong>
              </>
            }
            subtitle="If you see Open as Web App, leave it on."
          />
          <ListRow
            icon={<StepNumber>4</StepNumber>}
            title={
              <>
                Open Hoop Stats from its icon{' '}
                <img className={styles.appIcon} src={APP_ICON_URL} alt="" /> on your Home Screen
              </>
            }
            subtitle="Use it from there from now on."
          />
        </GroupedList>

        <GroupedList header="Why it matters" headingLevel={3}>
          <ListRow
            icon="📶"
            title="Works offline"
            subtitle="Record stats in any gym, even with no signal."
          />
          <ListRow
            icon="🔒"
            title="Keeps your stats safe"
            subtitle="Safari can clear a website's data after a few weeks without a visit. Home Screen apps keep theirs."
          />
          <InstallFirstTip />
        </GroupedList>

        {isIosDevice() ? null : (
          <p className={styles.otherDevices}>
            Not on an iPhone? In Chrome on Android, open the ⋮ menu and tap Add to Home screen.
          </p>
        )}
      </div>
    </Sheet>
  );
}
