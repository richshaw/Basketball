import { useState } from 'react';
import { Button } from '@/components/Button/Button';
import { CloseIcon } from '@/components/Icons/Icons';
import { APP_ICON_URL, rememberInstallBannerDismissed, shouldShowInstallBanner } from './install';
import { InstallSheet } from './InstallSheet';
import styles from './InstallBanner.module.css';

/**
 * Suggests adding Hoop Stats to the Home Screen, like Safari's own app banners. Only
 * in iPhone/iPad Safari, never in the installed app, and a dismissal lasts 14 days.
 * Rendered by AppShell (the tab screens), so it never shows on the live game screen.
 */
export function InstallBanner() {
  const [visible, setVisible] = useState(() => shouldShowInstallBanner());
  const [sheetOpen, setSheetOpen] = useState(false);

  // The sheet can only be open while the banner shows (it's modal), so both go together.
  if (!visible) return null;

  const dismiss = () => {
    rememberInstallBannerDismissed();
    setVisible(false);
  };

  return (
    <>
      <aside className={styles.banner} aria-label="Add to Home Screen">
        <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={dismiss}>
          <CloseIcon className={styles.dismissIcon} />
        </button>
        <img className={styles.appIcon} src={APP_ICON_URL} alt="" />
        <p className={styles.message}>
          Add Hoop Stats to your Home Screen so it works offline and your stats stay safe.
        </p>
        <Button className={styles.how} onClick={() => setSheetOpen(true)}>
          How
        </Button>
      </aside>
      <InstallSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
