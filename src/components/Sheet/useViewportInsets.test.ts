import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readViewportInsets, useViewportInsets } from './useViewportInsets';

/** A stand-in for window.visualViewport that tests can resize and scroll. */
class FakeVisualViewport extends EventTarget {
  height = 797;
  offsetTop = 0;
  scale = 1;

  /** Simulates the keyboard opening (or closing) and iOS panning the page. */
  update(changes: Partial<Pick<FakeVisualViewport, 'height' | 'offsetTop' | 'scale'>>) {
    Object.assign(this, changes);
    this.dispatchEvent(new Event('resize'));
  }
}

const originals = {
  visualViewport: Object.getOwnPropertyDescriptor(window, 'visualViewport'),
  innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
};

function installViewport(innerHeight = 797) {
  const viewport = new FakeVisualViewport();
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
  return viewport;
}

afterEach(() => {
  for (const [name, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else Reflect.deleteProperty(window, name);
  }
});

describe('readViewportInsets', () => {
  it('is zero while the whole layout viewport is visible', () => {
    const viewport = installViewport();
    expect(readViewportInsets(window)).toEqual({ top: 0, bottom: 0 });
    viewport.update({ height: 797 });
    expect(readViewportInsets(window)).toEqual({ top: 0, bottom: 0 });
  });

  it('reports the keyboard at the bottom and what iOS scrolled away at the top', () => {
    const viewport = installViewport();
    viewport.height = 461.4; // a 336px keyboard
    expect(readViewportInsets(window)).toEqual({ top: 0, bottom: 336 });

    viewport.offsetTop = 120; // iOS scrolled the page up to reveal the field
    expect(readViewportInsets(window)).toEqual({ top: 120, bottom: 216 });
  });

  it('ignores pinch zoom and browsers without the Visual Viewport API', () => {
    const viewport = installViewport();
    viewport.scale = 2;
    viewport.height = 398;
    expect(readViewportInsets(window)).toEqual({ top: 0, bottom: 0 });

    Reflect.deleteProperty(window, 'visualViewport');
    expect(readViewportInsets(window)).toEqual({ top: 0, bottom: 0 });
  });
});

describe('useViewportInsets', () => {
  it('follows the keyboard while active', () => {
    const viewport = installViewport();
    const { result } = renderHook(() => useViewportInsets(true));
    expect(result.current).toEqual({ top: 0, bottom: 0 });

    act(() => viewport.update({ height: 461 }));
    expect(result.current).toEqual({ top: 0, bottom: 336 });

    act(() => viewport.update({ height: 797 }));
    expect(result.current).toEqual({ top: 0, bottom: 0 });
  });

  it('stays at zero, without listening, while inactive', () => {
    const viewport = installViewport();
    viewport.height = 461;
    const { result, rerender } = renderHook(({ active }) => useViewportInsets(active), {
      initialProps: { active: false },
    });
    expect(result.current).toEqual({ top: 0, bottom: 0 });

    rerender({ active: true });
    expect(result.current).toEqual({ top: 0, bottom: 336 });
  });

  it('is zero without the Visual Viewport API', () => {
    const { result } = renderHook(() => useViewportInsets(true));
    expect(result.current).toEqual({ top: 0, bottom: 0 });
  });
});
