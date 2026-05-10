import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement window.matchMedia. Tests that exercise media-query
// behavior should override this with their own mock per-test (see
// useMediaQuery.test.tsx). This default returns "no match" so unrelated tests
// don't crash on first read.
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
