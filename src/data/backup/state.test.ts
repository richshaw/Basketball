import { describe, expect, it } from 'vitest';
import { db, META_KEYS } from '../db';
import { buildDemoData } from '../demo';
import { getLastChangeAt } from '../repo';
import { clearAllData, exportAll, importAll } from '../transfer';
import { generateBackupCode, parseBackupCode } from './code';
import { deriveBackupKeys } from './keys';
import {
  BACKUP_STATE_KEY,
  clearBackupState,
  createBackupState,
  loadBackupState,
  replaceBackupState,
  updateBackupState,
} from './state';

describe('cloud backup state', () => {
  it('is off until turned on, and a second "turn on" keeps the first code', async () => {
    expect(await loadBackupState()).toBeUndefined();
    const code = generateBackupCode();
    expect(await createBackupState({ code, enabledAt: 1000 })).toEqual({ code, enabledAt: 1000 });
    const again = await createBackupState({ code: generateBackupCode(), enabledAt: 2000 });
    expect(again).toEqual({ code, enabledAt: 1000 });
    expect(await loadBackupState()).toEqual({ code, enabledAt: 1000 });
  });

  it('patches like the repository: undefined keeps, null clears', async () => {
    const state = await createBackupState({ code: generateBackupCode(), enabledAt: 1000 });
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

  it('drops a write for a backup that was turned off or replaced meanwhile', async () => {
    const first = await createBackupState({ code: generateBackupCode(), enabledAt: 1000 });
    const second = await replaceBackupState({ code: generateBackupCode(), enabledAt: 2000 });
    expect(await updateBackupState(first, { lastSuccessAt: 3000 })).toBeUndefined();
    expect(await clearBackupState(first)).toBe(false);
    expect(await loadBackupState()).toEqual(second);
    expect(await clearBackupState(second)).toBe(true);
    expect(await loadBackupState()).toBeUndefined();
    expect(await clearBackupState()).toBe(false);
  });

  it('drops invalid fields but never the code; an unreadable code reads as off', async () => {
    const code = generateBackupCode();
    await db.meta.put({
      key: BACKUP_STATE_KEY,
      value: { code, enabledAt: 1, failures: -1, paused: 'later', lastError: { kind: 1 } },
    });
    expect(await loadBackupState()).toEqual({ code, enabledAt: 1 });
    await db.meta.put({ key: BACKUP_STATE_KEY, value: { code: 'not-a-code', enabledAt: 1 } });
    expect(await loadBackupState()).toBeUndefined();
  });

  it('is never exported, survives "Erase all data" and doesn\'t count as a data change', async () => {
    await importAll(buildDemoData({ today: '2026-09-27' }), 'replace');
    const changedAt = await getLastChangeAt();
    const code = generateBackupCode();
    const state = await createBackupState({ code, enabledAt: 1000 });
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
    await importAll(buildDemoData({ today: '2026-09-27' }), 'replace');
    expect(await loadBackupState()).toMatchObject({ code });
    expect(await db.meta.get(META_KEYS.lastChangeAt)).toBeDefined();
  });
});
