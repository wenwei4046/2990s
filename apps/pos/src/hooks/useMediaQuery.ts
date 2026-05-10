import { useEffect, useState } from 'react';

/**
 * Reactive media query subscription. Returns whether the query currently
 * matches; updates on viewport changes.
 *
 * Usage:
 *   const isDesktop = useMediaQuery(
 *     '(min-width: 1280px) and (hover: hover) and (pointer: fine)'
 *   );
 *
 * The combined query is intentional: hover/pointer guards exclude iPad Pro
 * 12.9" (1366×1024) without a Magic Keyboard from desktop layout. See spec
 * §2.1 for the device matrix.
 *
 * Pass a stable string reference. Template literals computed inline re-allocate
 * each render and force re-subscription via the [query] dependency.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
