import { describe, expect, it } from 'vitest';
import { cx } from './cx';

describe('cx', () => {
  it('joins class names and skips falsy values', () => {
    expect(cx('button', false, 'primary', undefined, null, '', 'block')).toBe(
      'button primary block',
    );
  });

  it('returns an empty string when nothing is set', () => {
    expect(cx(undefined, false)).toBe('');
  });
});
