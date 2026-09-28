import { describe, expect, it } from 'vitest';
import { barLayout, columnPath, niceAxis, scaleY, slotIndexAt } from './chartScale';

describe('niceAxis', () => {
  it.each([
    [18, 20, [0, 5, 10, 15, 20]],
    [20, 20, [0, 5, 10, 15, 20]],
    [12, 12, [0, 2, 4, 6, 8, 10, 12]],
    [9, 10, [0, 2, 4, 6, 8, 10]],
    [8, 8, [0, 2, 4, 6, 8]],
    [6, 6, [0, 2, 4, 6]],
    [3, 3, [0, 1, 2, 3]],
    [1, 1, [0, 1]],
    [31, 40, [0, 10, 20, 30, 40]],
    [48, 50, [0, 10, 20, 30, 40, 50]],
  ])('fits %d under a clean top of %d', (max, top, ticks) => {
    expect(niceAxis(max)).toEqual({ max: top, ticks });
  });

  it('uses whole-number steps for small decimals (stats are counts)', () => {
    expect(niceAxis(2.4)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(niceAxis(0.4)).toEqual({ max: 1, ticks: [0, 1] });
  });

  it('still draws an axis for an empty or all-zero series', () => {
    expect(niceAxis(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceAxis(Number.NaN)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceAxis(-3)).toEqual({ max: 1, ticks: [0, 1] });
  });

  it('can aim for a different number of intervals', () => {
    expect(niceAxis(18, 2)).toEqual({ max: 20, ticks: [0, 10, 20] });
  });
});

describe('barLayout', () => {
  it('splits the width into equal slots with a bar centered in each', () => {
    const layout = barLayout(10, 0, 300);
    expect(layout.slotWidth).toBe(30);
    expect(layout.barWidth).toBeCloseTo(18.6);
    expect(layout.slots).toHaveLength(10);
    const second = layout.slots[1];
    expect(second?.slotX).toBe(30);
    expect(second?.center).toBe(45);
    expect(second?.barX).toBeCloseTo(45 - 18.6 / 2);
  });

  it('caps bars at 24px however few games there are', () => {
    const layout = barLayout(2, 0, 300);
    expect(layout.barWidth).toBe(24);
    expect(layout.slots[0]?.barX).toBe(75 - 12);
  });

  it('keeps air between bars when there are many games, and never goes under 1px', () => {
    expect(barLayout(100, 0, 300).barWidth).toBe(1);
    expect(barLayout(50, 0, 300).barWidth).toBeCloseTo(3.72);
    const crowded = barLayout(75, 0, 300);
    expect(crowded.slotWidth - crowded.barWidth).toBeGreaterThanOrEqual(2);
  });

  it('starts at the given left edge', () => {
    expect(barLayout(3, 12, 90).slots.map((slot) => slot.slotX)).toEqual([12, 42, 72]);
  });

  it('has no slots for no games or no room', () => {
    expect(barLayout(0, 0, 300)).toEqual({ slotWidth: 0, barWidth: 0, slots: [] });
    expect(barLayout(5, 0, 0).slots).toEqual([]);
  });
});

describe('scaleY', () => {
  it('maps 0 to the baseline and the axis top to the top of the plot', () => {
    expect(scaleY(0, 20, 170, 150)).toBe(170);
    expect(scaleY(20, 20, 170, 150)).toBe(20);
    expect(scaleY(10, 20, 170, 150)).toBe(95);
  });

  it('keeps values inside the plot', () => {
    expect(scaleY(-5, 20, 170, 150)).toBe(170);
    expect(scaleY(25, 20, 170, 150)).toBe(20);
    expect(scaleY(5, 0, 170, 150)).toBe(170);
  });
});

describe('columnPath', () => {
  it('rounds the data end and keeps the base square', () => {
    expect(columnPath(10, 50, 20, 150)).toBe('M10,150V54A4,4 0 0 1 14,50H26A4,4 0 0 1 30,54V150Z');
  });

  it('shrinks the rounding for thin or short columns', () => {
    expect(columnPath(0, 148, 6, 150)).toBe('M0,150V150A2,2 0 0 1 2,148H4A2,2 0 0 1 6,150V150Z');
  });

  it('draws nothing for a zero-height or zero-width column', () => {
    expect(columnPath(10, 150, 20, 150)).toBe('');
    expect(columnPath(10, 50, 0, 150)).toBe('');
  });
});

describe('slotIndexAt', () => {
  it('finds the slot under a point, clamped to the first and last', () => {
    expect(slotIndexAt(0, 300, 10)).toBe(0);
    expect(slotIndexAt(29.9, 300, 10)).toBe(0);
    expect(slotIndexAt(30, 300, 10)).toBe(1);
    expect(slotIndexAt(299, 300, 10)).toBe(9);
    expect(slotIndexAt(-40, 300, 10)).toBe(0);
    expect(slotIndexAt(400, 300, 10)).toBe(9);
  });

  it('falls back to the first slot when there is nothing to measure', () => {
    expect(slotIndexAt(50, 0, 10)).toBe(0);
    expect(slotIndexAt(Number.NaN, 300, 10)).toBe(0);
    expect(slotIndexAt(50, 300, 0)).toBe(0);
  });
});
