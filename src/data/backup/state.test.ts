import { describe, expect, it } from 'vitest';
import { buildRealData } from '@/test/backupHarness';
import { db } from '../db';
import { getLastChangeAt } from '../repo';
import { clearAllData, exportAll, importAll } from '../transfer';
import { generateBackupCode, parseBackupCode } from './code';
import { deriveBackupKeys } from './keys';
import {
  BACKUP_STATE_KEY,
  clearBackupState,
  isBackupOn,
  loadBackupState,
  replaceBackupState,
  turnOffBackupState,
  turnOnBackupState,
  updateBackupState,
} from './state';

describe('cloud backup state', () => {
  it('has no code until turned on, and a second "turn on" keeps the first code', async () => {
    expect(await loadBackupState()).toBeUndefined();
    const code = generateBackupCode();
    expect(await turnOnBackupState(code, 1000)).toEqual({ code, enabledAt: 1000 });
    expect(await turnOnBackupState(generateBackupCode(), 2000)).toEqual({ code, enabledAt: 1000 });
    expect(isBackupOn(await loadBackupState())).toBe(true);
  });

  it('keeps the code (and what it knows) when turned off, and reuses it when turned on', async () => {
    const code = generateBackupCode();
    const on = await turnOnBackupState(code, 1000);
    await updateBackupState(on, {
      lastVersion: 'v1',
      backedUpGameIds: ['a', 'b'],
      backedUpEventCount: 30,
      lastError: { kind: 'network', message: 'No signal', at: 1500 },
      failures: 2,
      paused: 'shrink',
    });
    expect(await turnOffBackupState(on, 3000)).toBe(true);
    const off = await loadBackupState();
    expect(off).toEqual({
      code,
      enabledAt: 1000,
      disabledAt: 3000,
      lastVersion: 'v1',
      backedUpGameIds: ['a', 'b'],
      backedUpEventCount: 30,
    });
    expect(isBackupOn(off)).toBe(false);
    // Writes for the backup as it was on are dropped.
    expect(await updateBackupState(on, { lastSuccessAt: 4000 })).toBeUndefined();
    expect(await turnOffBackupState(on, 3500)).toBe(false);

    expect(await turnOnBackupState(generateBackupCode(), 5000)).toEqual({
      code,
      enabledAt: 5000,
      lastVersion: 'v1',
      backedUpGameIds: ['a', 'b'],
      backedUpEventCount: 30,
    });
  });

  it('patches like the repository: undefined keeps, null clears', async () => {
    const state = await turnOnBackupState(generateBackupCode(), 1000);
    await updateBackupState(state, {
      lastSuccessAt: 2000,
      failures: 2,
      lastError: { kind: 'network', message: 'No signal', at: 1500 },
    });
    const updated = await updateBackupState(state, { failures: null, lastSuccessAt: undefined });
    expect(updated).toEqual({
      ...state,
      lastSuccessAt: 2000,
      lastError: { kind: 'network', message: 'No signal', at: 1500 },
    });
    expect(await loadBackupState()).toEqual(updated);
  });

  it('drops a write for a backup that was replaced or forgotten meanwhile', async () => {
    const first = await turnOnBackupState(generateBackupCode(), 1000);
    const second = await replaceBackupState({ code: generateBackupCode(), enabledAt: 2000 });
    expect(await updateBackupState(first, { lastSuccessAt: 3000 })).toBeUndefined();
    expect(await clearBackupState(first)).toBe(false);
    expect(await loadBackupState()).toEqual(second);
    expect(await clearBackupState(second)).toBe(true);
    expect(await loadBackupState()).toBeUndefined();
    expect(await clearBackupState()).toBe(false);
  });

  it('drops invalid fields but never the code; an unreadable code reads as none', async () => {
    const code = generateBackupCode();
    await db.meta.put({
      key: BACKUP_STATE_KEY,
      value: {
        code,
        enabledAt: 1,
        failures: -1,
        paused: 'later',
        lastError: { kind: 1 },
        backedUpGameIds: ['a', 2],
        otherDevice: { version: 'v2', createdAt: 5 },
        shrink: { backedUpGames: 3 },
      },
    });
    expect(await loadBackupState()).toEqual({
      code,
      enabledAt: 1,
      otherDevice: { version: 'v2', createdAt: 5 },
    });
    await db.meta.put({ key: BACKUP_STATE_KEY, value: { code: 'not-a-code', enabledAt: 1 } });
    expect(await loadBackupState()).toBeUndefined();
  });

  it('is never exported, survives "Erase all data" and doesn\'t count as a data change', async () => {
    await importAll(buildRealData(), 'replace');
    const changedAt = await getLastChangeAt();
    const code = generateBackupCode();
    const state = await turnOnBackupState(code, 1000);
    await updateBackupState(state, { lastSuccessAt: 2000 });
    expect(await getLastChangeAt()).toBe(changedAt);

    const keys = await deriveBackupKeys(parseBackupCode(code));
    const exported = JSON.stringify(await exportAll());
    for (const secret of [code, code.replace(/-/g, ''), keys.accountId, keys.authToken]) {
      expect(exported).not.toContain(secret);
    }
    expect(exported).not.toContain(BACKUP_STATE_KEY);

    await clearAllData();
    expect(await loadBackupState()).toMatchObject({ code, lastSuccessAt: 2000 });
    await importAll(buildRealData(), 'replace');
    expect(await loadBackupState()).toMatchObject({ code });
  });
});
