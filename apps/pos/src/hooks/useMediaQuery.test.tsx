import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery';

describe('useMediaQuery', () => {
  let listeners: ((e: MediaQueryListEvent) => void)[] = [];
  let mockMatches = false;

  beforeEach(() => {
    listeners = [];
    mockMatches = false;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        get matches() { return mockMatches; },
        media: query,
        onchange: null,
        addEventListener: (_: string, h: (e: MediaQueryListEvent) => void) => {
          listeners.push(h);
        },
        removeEventListener: (_: string, h: (e: MediaQueryListEvent) => void) => {
          listeners = listeners.filter((l) => l !== h);
        },
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it('returns false when media query does not match initially', () => {
    mockMatches = false;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(false);
  });

  it('returns true when media query matches initially', () => {
    mockMatches = true;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(true);
  });

  it('updates when matchMedia change event fires', () => {
    mockMatches = false;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(result.current).toBe(false);

    act(() => {
      mockMatches = true;
      listeners.forEach((l) => l({ matches: true } as MediaQueryListEvent));
    });
    expect(result.current).toBe(true);

    act(() => {
      mockMatches = false;
      listeners.forEach((l) => l({ matches: false } as MediaQueryListEvent));
    });
    expect(result.current).toBe(false);
  });

  it('removes listener on unmount', () => {
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1280px)'));
    expect(listeners.length).toBe(1);
    unmount();
    expect(listeners.length).toBe(0);
  });

  it('re-subscribes when query changes', () => {
    const { rerender } = renderHook(
      ({ query }: { query: string }) => useMediaQuery(query),
      { initialProps: { query: '(min-width: 1280px)' } },
    );
    expect(listeners.length).toBe(1);

    // Change the query — old listener should be cleaned up, new one installed.
    rerender({ query: '(min-width: 768px)' });
    expect(listeners.length).toBe(1);
  });
});
