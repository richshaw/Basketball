/** Text for the Storage section. Pure. */
import type { StorageStatus } from '@/data/persistence';

/** Decimal units, like iOS shows storage: '850 KB', '1.2 MB'. */
const UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  const whole = Math.round(bytes);
  if (whole < 1000) return whole === 1 ? '1 byte' : `${whole} bytes`;
  let value = bytes / 1000;
  let unit = 0;
  // Move up a unit when the value would read 1000 or more (999.96 KB is 1.0 MB).
  while (unit < UNITS.length - 1 && Math.round(value) >= 1000) {
    value /= 1000;
    unit += 1;
  }
  // One decimal below 10, none from 10 up, judged after rounding: 9.96 KB reads
  // '10 KB', like 10 KB itself, not '10.0 KB'.
  const tenths = value.toFixed(1);
  const text = Number(tenths) < 10 ? tenths : String(Math.round(value));
  return `${text} ${UNITS[unit]}`;
}

/** The "Protected from automatic clearing" value. */
export function protectionLabel(persisted: StorageStatus['persisted']): string {
  if (persisted === null) return 'Unknown';
  return persisted ? 'Yes' : 'No';
}

/** One line on what the protection means here, and what to do about it. */
export function protectionExplanation(
  persisted: StorageStatus['persisted'],
  standalone: boolean,
): string {
  if (persisted) return "This browser won't clear your stats to free up space.";
  if (standalone) return 'If this phone runs very low on space, save a backup file to be safe.';
  return 'Safari can clear website data. Add Hoop Stats to your Home Screen to keep your stats safe.';
}
