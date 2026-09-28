import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHexColor, relativeLuminance } from './color';

describe('parseHexColor', () => {
  it('reads long and short hex colors', () => {
    expect(parseHexColor('#f97316')).toEqual([249, 115, 22]);
    expect(parseHexColor('#FFF')).toEqual([255, 255, 255]);
  });

  it('rejects anything else', () => {
    expect(() => parseHexColor('rgb(0, 0, 0)')).toThrow('Not a hex color');
    expect(() => parseHexColor('#12345')).toThrow('Not a hex color');
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    // WebAIM checker: #767676 on white is 4.54:1, the classic "just passes AA" grey.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('does not depend on argument order', () => {
    expect(contrastRatio('#2563eb', '#ffffff')).toBe(contrastRatio('#ffffff', '#2563eb'));
  });
});
