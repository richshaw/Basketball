import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNow } from './useNow';

describe('useNow', () => {
  it('moves on while the screen is open, and stops when it closes', () => {
    const start = new Date(2026, 8, 28, 19, 42).getTime();
    vi.useFakeTimers({ now: start });
    const { result, unmount } = renderHook(() => useNow(15_000));
    expect(result.current).toBe(start);

    act(() => {
      vi.advanceTimersByTime(14_999);
    });
    expect(result.current).toBe(start);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(start + 15_000);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current).toBe(start + 135_000);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
