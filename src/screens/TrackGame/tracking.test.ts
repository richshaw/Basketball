import { describe, expect, it } from 'vitest';
import type { StatType } from '@/data/types';
import {
  countByType,
  createTapGuard,
  formatClockTime,
  foulStatus,
  notSavedMessage,
  notSavedTitle,
  parseScore,
  periodChoices,
  spotNote,
  statKind,
  statLabel,
  unsavedNote,
  widestWordEm,
  widestWordOnCanvas,
  withTaps,
  type TextMeasurer,
} from './tracking';

describe('countByType', () => {
  it('counts each stat type, with every type present', () => {
    const counts = countByType([{ type: 'fg2_made' }, { type: 'foul' }, { type: 'fg2_made' }]);
    expect(counts.fg2_made).toBe(2);
    expect(counts.foul).toBe(1);
    expect(counts.charge).toBe(0);
    expect(Object.keys(counts)).toHaveLength(15);
  });

  it('skips types it does not know', () => {
    const counts = countByType([{ type: 'dunk' as StatType }, { type: 'toString' as StatType }]);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
});

describe('withTaps', () => {
  it('adds the taps not among the saved stats, each stat once', () => {
    const saved = [
      { id: 'a', type: 'stl' as const },
      { id: 'b', type: 'ast' as const },
    ];
    expect(withTaps(saved, [])).toBe(saved);
    expect(withTaps(saved, [{ id: 'b', type: 'ast' }])).toBe(saved);
    expect(
      withTaps(saved, [
        { id: 'b', type: 'ast' },
        { id: 'c', type: 'blk' },
      ]).map((stat) => stat.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('leaves out the stats being taken back, even while they are still saved', () => {
    const saved = [
      { id: 'a', type: 'stl' as const },
      { id: 'b', type: 'ast' as const },
    ];
    expect(withTaps(saved, [], ['a']).map((stat) => stat.id)).toEqual(['b']);
    expect(
      withTaps(saved, [{ id: 'c', type: 'blk' }], ['b', 'gone']).map((stat) => stat.id),
    ).toEqual(['a', 'c']);
  });
});

describe('not saved yet', () => {
  it('says plainly what happens to the stats', () => {
    expect(notSavedTitle(1)).toBe("1 stat isn't saved yet");
    expect(notSavedTitle(3)).toBe("3 stats aren't saved yet");
    expect(unsavedNote(1, true)).toBe("It's kept on this phone and will be saved automatically.");
    expect(unsavedNote(1, false)).toBe(
      "It's not kept on this phone. Keep the app open until it's saved.",
    );
    expect(unsavedNote(2, false)).toBe(
      "They're not kept on this phone. Keep the app open until they're saved.",
    );
    expect(notSavedMessage(1, true)).toBe(
      "1 stat isn't saved yet. It's kept on this phone and will be saved automatically.",
    );
    expect(notSavedMessage(2, true)).toBe(
      "2 stats aren't saved yet. They're kept on this phone and will be saved automatically.",
    );
  });
});

describe('spotNote', () => {
  const inside = { x: -6, y: 13.75 };
  const beyond = { x: 0, y: 22 };
  const corner = { x: 22, y: -3 };

  it("says how to mark a shot's spot while the court takes it, then that it's marked", () => {
    expect(spotNote('fg2_made', undefined, true)).toBe('Tap the court to mark the spot');
    expect(spotNote('fg2_made', undefined, false)).toBeUndefined();
    expect(spotNote('fg2_made', inside, true)).toBe('Spot marked');
    expect(spotNote('fg3_miss', beyond, false)).toBe('Spot marked');
    expect(spotNote('fg3_made', corner, true)).toBe('Spot marked');
  });

  it('notes a spot on the other side of the arc from the button tapped', () => {
    expect(spotNote('fg2_miss', beyond, true)).toBe('Spot marked · beyond the arc');
    expect(spotNote('fg2_made', corner, false)).toBe('Spot marked · beyond the arc');
    expect(spotNote('fg3_made', inside, true)).toBe('Spot marked · inside the arc');
  });
});

describe('statLabel and statKind', () => {
  it('use the stat definitions, and cope with a type this app does not know', () => {
    expect(statLabel('fg3_made')).toBe('3PT Made');
    expect(statLabel('charge')).toBe('Charge Taken');
    expect(statLabel('dunk' as StatType)).toBe('dunk');
    expect(statLabel('toString' as StatType)).toBe('toString');
    expect([statKind('fg2_made'), statKind('ft_miss'), statKind('stl')]).toEqual([
      'made',
      'miss',
      'other',
    ]);
    expect(statKind('dunk' as StatType)).toBe('other');
    expect(statKind('constructor' as StatType)).toBe('other');
  });
});

describe('createTapGuard', () => {
  it('lets one call through per window, counted from the last one let through', () => {
    let time = 1000;
    const guard = createTapGuard(400, () => time);
    const tapAt = (at: number) => {
      time = at;
      return guard();
    };
    expect([tapAt(1000), tapAt(1120), tapAt(1399), tapAt(1400), tapAt(1700), tapAt(1800)]).toEqual([
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
  });
});

describe('formatClockTime', () => {
  it('shows local 12-hour time with seconds and no AM/PM', () => {
    expect(formatClockTime(new Date(2026, 8, 27, 19, 4, 5).getTime())).toBe('7:04:05');
    expect(formatClockTime(new Date(2026, 8, 27, 0, 30, 0).getTime())).toBe('12:30:00');
    expect(formatClockTime(new Date(2026, 8, 27, 12, 0, 59).getTime())).toBe('12:00:59');
    expect(formatClockTime(new Date(2026, 8, 27, 9, 59, 9).getTime())).toBe('9:59:09');
  });
});

describe('periodChoices', () => {
  it('offers regulation plus four overtimes', () => {
    expect(periodChoices(1, 'quarters')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(periodChoices(2, 'halves')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('always offers the period after the current one, up to the maximum', () => {
    expect(periodChoices(8, 'quarters')).toHaveLength(9);
    expect(periodChoices(20, 'quarters')).toHaveLength(20);
  });
});

describe('foulStatus', () => {
  it('flags foul trouble at 4 and fouled out at 5 or more', () => {
    expect([0, 3, 4, 5, 6].map(foulStatus)).toEqual(['ok', 'ok', 'trouble', 'out', 'out']);
  });
});

describe('parseScore', () => {
  it('reads blank as "not given" and whole numbers up to 999 as scores', () => {
    expect(parseScore('')).toBeUndefined();
    expect(parseScore('  ')).toBeUndefined();
    expect(parseScore('0')).toBe(0);
    expect(parseScore(' 42 ')).toBe(42);
    expect(parseScore('999')).toBe(999);
  });

  it('rejects anything else', () => {
    for (const text of ['1000', '-3', '4.5', '4a', 'forty', '1e2']) {
      expect(parseScore(text), text).toBeNull();
    }
  });
});

describe('widestWordEm', () => {
  it('measures each word and returns the widest', () => {
    const measure = (word: string) => word.length / 2;
    expect(widestWordEm('Charge Taken', measure)).toBe(3);
    expect(widestWordEm('Deflection', measure)).toBe(5);
    expect(widestWordEm('  ', measure)).toBe(0);
  });
});

describe('widestWordOnCanvas', () => {
  /**
   * A canvas context that, like a browser's, gives the font back serialized, and
   * ignores a font it can't parse (keeping the one it had). Each letter is 12px wide.
   */
  function canvas(parses: (font: string) => string | null): TextMeasurer {
    let font = '10px sans-serif';
    return {
      get font() {
        return font;
      },
      set font(value: string) {
        font = parses(value) ?? font;
      },
      measureText: (text: string) => ({ width: text.length * 12 }),
    };
  }

  it('measures in the label font, in em', () => {
    const context = canvas((font) => font.replace('normal ', ''));
    const font = 'normal 700 24px -apple-system, "SF Pro Text", system-ui, sans-serif';
    expect(widestWordOnCanvas(context, font, 24, ['Turn-', 'over', 'Charge'])).toBe(3);
    expect(context.font).toBe('700 24px -apple-system, "SF Pro Text", system-ui, sans-serif');
    expect(
      widestWordOnCanvas(
        canvas((value) => value),
        'bold 21.5px/1.2 serif',
        21.5,
        ['ab'],
      ),
    ).toBe(24 / 21.5);
    expect(
      widestWordOnCanvas(
        canvas((value) => value),
        'bold 24px serif',
        24,
        [],
      ),
    ).toBeUndefined();
  });

  it("gives up if the canvas didn't take the font, rather than measure in its own", () => {
    const context = canvas(() => null);
    expect(widestWordOnCanvas(context, '700 24px ???', 24, ['Charge'])).toBeUndefined();
    expect(context.font).toBe('10px sans-serif');
  });
});
