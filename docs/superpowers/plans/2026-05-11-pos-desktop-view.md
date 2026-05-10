# POS Desktop Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop tier layout to POS at `min-width:1280px` with `hover:hover` + `pointer:fine` guards, so counter desktops (FHD mouse + keyboard) get a `<CartRail>` next to the Catalog grid while iPad tablets retain the locked tablet-first layout.

**Architecture:** Single primary breakpoint with hover/pointer media features (so iPad Pro without keyboard stays on tablet). One new `useMediaQuery` hook + one new `<CartRail>` component, mounted only on `/catalog`. Refactor `Cart.tsx` to extract `<CartContents>` so both `/cart` route and `<CartRail>` reuse the same JSX. Per-page CSS desktop blocks where needed.

**Tech Stack:** React 19 (TS strict), Zustand (existing `useCart` store, no schema change), React Router 7, CSS Modules + design-system tokens. Adds vitest + jsdom + `@testing-library/react` to `apps/pos` (was previously test-runner-less).

---

## Spec corrections (discovered while writing this plan)

Three findings during code archaeology that adjust scope smaller than the spec implied. The deviation log entry (Task 7) reflects reality, not the original spec.

1. **No cart fab in production POS code.** `Catalog.tsx` uses `Topbar`'s cart pill — there is no floating fab. Spec §4.1 said "hide fab at desktop"; no fab exists to hide. CartRail simply mounts on the right; Topbar cart pill stays visible (acceptable per spec §6.5).
2. **Handover form is already responsive at desktop.** `Handover.module.css` already has `.fieldRow { grid-template-columns: 1fr 1fr }` and `.fieldRow3 { grid-template-columns: 1fr 1fr 1fr }` as defaults, with a `@media (max-width: 880px)` block that collapses them on small screens. At iPad landscape (≥1180px) and FHD (1920px), the form is already 2/3-col. **No Handover work in this plan.** Spec §4.2 is moot.
3. **Most other pages have appropriate max-widths already.** Cart shell is 920px (deliberately narrow for line-list reading), OrderConfirmed card is 520px (intentional emotional centering), OrderStatus is 480/1400 mixed, Quotes is 1200, Login is centered with no width constraint to widen. Spec §4.5 listed cosmetic max-width tweaks as a pass; on inspection none are clearly worth doing. **No cosmetic-only max-width tweaks in this plan.** If the user wants them later, they can be one-line CSS additions.

Net effect: 8 tasks instead of the 11–13 the spec implied. ~3–4 days work instead of ~5–7.

---

## File Structure

**Created:**

```
apps/pos/
├── vitest.config.ts                              (NEW — vitest entry)
├── test/
│   └── setup.ts                                  (NEW — jsdom + matchMedia mock)
└── src/
    ├── hooks/
    │   ├── useMediaQuery.ts                      (NEW — ~30 LOC)
    │   └── useMediaQuery.test.tsx                (NEW — TDD test)
    └── components/
        ├── CartContents.tsx                      (NEW — extracted from Cart.tsx)
        ├── CartContents.module.css               (NEW — moved from Cart.module.css)
        ├── CartRail.tsx                          (NEW — sticky right panel)
        └── CartRail.module.css                   (NEW)
```

**Modified:**

```
apps/pos/
├── package.json                                  (add devDeps + "test" script)
└── src/
    ├── pages/
    │   ├── Cart.tsx                              (use <CartContents variant="page"/>)
    │   ├── Cart.module.css                       (remove cart-internals — moved to CartContents.module.css)
    │   ├── Catalog.tsx                           (mount <CartRail/> conditionally)
    │   └── Catalog.module.css                    (+ desktop block: 3-col layout)
    └── components/
        └── Topbar.module.css                     (+ desktop block: iconBtn 36→32)

UI_REFERENCE.md                                   (append §3 deviation entry)
```

**Untouched (locked or already adequate):**

- `Configurator.tsx` + `Configurator.module.css` (CLAUDE.md red line #2)
- `CustomBuilder.tsx` + `CustomBuilder.module.css` (CLAUDE.md red line #2)
- `Login.tsx` + `Login.module.css` (already centered)
- `Handover.tsx` + `Handover.module.css` (already responsive at ≥881px)
- `OrderConfirmed.module.css`, `OrderStatus.module.css`, `Quotes.module.css` (current widths fit content)
- `index.html`, `vite.config.ts` (PWA manifest, viewport meta — no effect on desktop browsers)
- `prototype/*` (tablet-canonical; this plan extends into desktop territory the prototype did not cover)

---

## Task 1: Set up vitest in `apps/pos`

POS currently has no test runner. The hook in Task 2 needs unit tests; this task lays the foundation.

**Files:**
- Create: `apps/pos/vitest.config.ts`
- Create: `apps/pos/test/setup.ts`
- Modify: `apps/pos/package.json` (add devDeps + `test` script)

- [ ] **Step 1: Add devDeps via pnpm**

Run from repo root:

```bash
pnpm --filter @2990s/pos add -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

Expected: `apps/pos/package.json` gets `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom` under `devDependencies`. `pnpm-lock.yaml` updates.

- [ ] **Step 2: Create `apps/pos/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: false,
  },
});
```

- [ ] **Step 3: Create `apps/pos/test/setup.ts`**

```ts
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
```

- [ ] **Step 4: Add `test` script to `apps/pos/package.json`**

Find the `"scripts"` block and add `"test": "vitest"` after `"typecheck"`. Result should look like:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest"
  }
}
```

- [ ] **Step 5: Verify vitest runs cleanly with no tests yet**

Run from repo root:

```bash
pnpm --filter @2990s/pos test --run
```

Expected: vitest reports `0 test files found, 0 tests, 0 passed, 0 failed`. Exit 0. (Some vitest versions exit non-zero on no-tests-found; if so, add a placeholder until Task 2 lands the first real test.)

- [ ] **Step 6: Commit**

```bash
git add apps/pos/vitest.config.ts apps/pos/test/setup.ts apps/pos/package.json pnpm-lock.yaml
git commit -m "chore(pos): set up vitest + jsdom + testing-library — Phase 5 desktop pass prep"
```

---

## Task 2: `useMediaQuery` hook (TDD)

The hook reads `window.matchMedia(query).matches` reactively, subscribing to `change` events. Used in `Catalog.tsx` to conditionally mount `<CartRail/>`.

**Files:**
- Create: `apps/pos/src/hooks/useMediaQuery.ts`
- Test: `apps/pos/src/hooks/useMediaQuery.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/pos/src/hooks/useMediaQuery.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
pnpm --filter @2990s/pos test --run useMediaQuery
```

Expected: `4 failed`. Each test errors on `Cannot find module './useMediaQuery'` — module does not exist yet.

- [ ] **Step 3: Write the hook**

Create `apps/pos/src/hooks/useMediaQuery.ts`:

```ts
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
```

- [ ] **Step 4: Run test, verify it passes**

```bash
pnpm --filter @2990s/pos test --run useMediaQuery
```

Expected: `4 passed`. All four cases green.

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @2990s/pos typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/hooks/useMediaQuery.ts apps/pos/src/hooks/useMediaQuery.test.tsx
git commit -m "feat(pos): useMediaQuery hook — desktop layout breakpoint detection"
```

---

## Task 3: Extract `<CartContents>` from `Cart.tsx`

Refactor only — `/cart` page must render identically before and after. The extraction enables `<CartRail>` (Task 4) to reuse the same line-list, qty-stepper, and subtotal logic without code duplication.

**Files:**
- Create: `apps/pos/src/components/CartContents.tsx`
- Create: `apps/pos/src/components/CartContents.module.css`
- Modify: `apps/pos/src/pages/Cart.tsx` (becomes a thin route wrapper)
- Modify: `apps/pos/src/pages/Cart.module.css` (keep page chrome, move line/footer styles to CartContents)

- [ ] **Step 1: Create `apps/pos/src/components/CartContents.tsx`**

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { Trash2, BookmarkPlus, Check } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useCart, cartSubtotal, type CartLine } from '../state/cart';
import { useSaveQuote } from '../lib/quotes';
import styles from './CartContents.module.css';

export type CartContentsVariant = 'page' | 'rail';

interface Props {
  variant: CartContentsVariant;
  onContinue: () => void;
}

export const CartContents = ({ variant, onContinue }: Props) => {
  const lines = useCart((s) => s.lines);
  const remove = useCart((s) => s.remove);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
  const subtotal = cartSubtotal(lines);
  const saveQuote = useSaveQuote();

  const [savingQuote, setSavingQuote] = useState(false);
  const [quoteName, setQuoteName] = useState('');
  const [quotePhone, setQuotePhone] = useState('');
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const submitSaveQuote = async () => {
    if (!quoteName.trim()) {
      setSaveErr('Customer name is required');
      return;
    }
    setSaveErr(null);
    try {
      await saveQuote.mutateAsync({
        customerName: quoteName.trim(),
        customerPhone: quotePhone.trim() || undefined,
        cart: lines,
        subtotal,
        total: subtotal,
      });
      clear();
      setSavingQuote(false);
      setQuoteName('');
      setQuotePhone('');
      setSavedConfirm(true);
      setTimeout(() => setSavedConfirm(false), 2400);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save quote');
    }
  };

  if (lines.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Cart is empty.</p>
        <Link to="/catalog"><Button variant="primary">Browse catalog</Button></Link>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${variant === 'rail' ? styles.rail : styles.page}`}>
      {savedConfirm && (
        <div className={styles.savedBanner}>
          <Check size={16} strokeWidth={1.75} />
          Quote saved. Open <Link to="/quotes">Saved quotes</Link> to load it later.
        </div>
      )}

      <ul className={styles.list}>
        {lines.map((l) => (
          <Line
            key={l.key}
            line={l}
            variant={variant}
            onRemove={remove}
            onSetQty={setQty}
          />
        ))}
      </ul>

      {savingQuote && (
        <section className={styles.quotePanel}>
          <h3 className={styles.quotePanelTitle}>
            <BookmarkPlus size={14} strokeWidth={1.75} />
            Save as quote
          </h3>
          <p className={styles.quotePanelHint}>
            Saves the cart so a sales colleague (or you later) can load it back.
          </p>
          <div className={styles.quoteFields}>
            <label className={styles.quoteField}>
              <span>Customer name *</span>
              <input
                type="text"
                value={quoteName}
                onChange={(e) => setQuoteName(e.target.value)}
                autoFocus
              />
            </label>
            <label className={styles.quoteField}>
              <span>Phone (optional)</span>
              <input
                type="tel"
                value={quotePhone}
                onChange={(e) => setQuotePhone(e.target.value)}
              />
            </label>
          </div>
          {saveErr && <p className={styles.quoteErr}>{saveErr}</p>}
          <div className={styles.quoteActions}>
            <Button
              variant="ghost"
              onClick={() => { setSavingQuote(false); setSaveErr(null); }}
              disabled={saveQuote.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitSaveQuote}
              disabled={saveQuote.isPending || !quoteName.trim()}
            >
              {saveQuote.isPending ? 'Saving…' : 'Save quote'}
            </Button>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <div className={styles.subtotalRow}>
          <span className="t-eyebrow">Subtotal</span>
          <PriceTag amount={subtotal} size={variant === 'rail' ? 'md' : 'lg'} />
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={clear}>Clear</Button>
          {!savingQuote && (
            <Button
              variant="ghost"
              onClick={() => setSavingQuote(true)}
              disabled={lines.length === 0}
            >
              <BookmarkPlus size={14} strokeWidth={1.75} />
              Save quote
            </Button>
          )}
          <Button variant="primary" onClick={onContinue}>
            Continue to handover
          </Button>
        </div>
      </footer>
    </div>
  );
};

const Line = ({ line, variant, onRemove, onSetQty }: {
  line: CartLine;
  variant: CartContentsVariant;
  onRemove: (k: string) => void;
  onSetQty: (k: string, q: number) => void;
}) => (
  <li className={`${styles.line} ${variant === 'rail' ? styles.lineRail : ''}`}>
    <div className={styles.lineMain}>
      <div className={styles.lineName}>{line.config.productName}</div>
      <div className={styles.lineSummary}>{line.config.summary}</div>
    </div>
    <div className={styles.qtyBox}>
      <button
        type="button"
        className={styles.qtyBtn}
        onClick={() => onSetQty(line.key, line.qty - 1)}
        aria-label="Decrease quantity"
      >−</button>
      <span className={styles.qty}>{line.qty}</span>
      <button
        type="button"
        className={styles.qtyBtn}
        onClick={() => onSetQty(line.key, line.qty + 1)}
        aria-label="Increase quantity"
      >+</button>
    </div>
    <div className={styles.lineTotal}>{fmtRM(line.qty * line.config.total)}</div>
    <IconButton
      icon={<Trash2 size={18} strokeWidth={1.75} />}
      aria-label="Remove line"
      onClick={() => onRemove(line.key)}
    />
  </li>
);
```

- [ ] **Step 2: Create `apps/pos/src/components/CartContents.module.css`**

Move the cart-internal styles here. Source these from `Cart.module.css`:

```css
/* Cart internal styles — shared by /cart route page and <CartRail/> */

.container {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.page { /* page-mode tweaks if any; reserved for future */ }
.rail { /* rail-mode: tighter line spacing */
  gap: var(--space-2);
}

.savedBanner {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--c-success-bg);
  color: var(--c-success);
  border-radius: var(--radius-pill);
  font-family: var(--font-button);
  font-size: var(--fs-13);
  font-weight: var(--w-semibold);
}
.savedBanner a { color: inherit; text-decoration: underline; }

.empty {
  text-align: center;
  padding: var(--space-7);
  color: var(--fg-muted);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: center;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.line {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--c-cream);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}

.lineRail {
  grid-template-columns: 1fr auto;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-12);
}
.lineRail .qtyBox { display: none; }
.lineRail .lineTotal { font-size: var(--fs-13); min-width: auto; }

.lineMain { min-width: 0; }
.lineName {
  font-family: var(--font-title);
  font-weight: var(--w-semibold);
  font-size: var(--fs-16);
  margin: 0 0 2px;
}
.lineRail .lineName {
  font-size: var(--fs-13);
}
.lineSummary {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.lineRail .lineSummary {
  font-size: var(--fs-11);
}

.qtyBox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-pill);
}
.qtyBtn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: var(--bg-alt);
  font-size: var(--fs-16);
  cursor: pointer;
}
.qtyBtn:hover { background: var(--bg); }
.qty {
  min-width: 24px;
  text-align: center;
  font-family: var(--font-mono);
  font-weight: var(--w-semibold);
}

.lineTotal {
  font-family: var(--font-title);
  font-weight: var(--w-bold);
  font-size: var(--fs-16);
  min-width: 100px;
  text-align: right;
}

.quotePanel {
  background: var(--c-cream);
  border: 1px solid var(--c-burnt);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.quotePanelTitle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-family: var(--font-title);
  font-weight: var(--w-bold);
  font-size: var(--fs-15);
  color: var(--c-burnt);
}
.quotePanelHint {
  margin: 0;
  font-size: var(--fs-12);
  color: var(--fg-muted);
}
.quoteFields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.quoteField {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.quoteField span {
  font-family: var(--font-button);
  font-size: var(--fs-11);
  font-weight: var(--w-semibold);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-soft);
}
.quoteField input {
  font: inherit;
  font-size: var(--fs-14);
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg);
}
.quoteField input:focus { outline: none; border-color: var(--c-burnt); }
.quoteErr {
  margin: 0;
  font-size: var(--fs-12);
  color: var(--c-error);
}
.quoteActions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 720px) {
  .quoteFields { grid-template-columns: 1fr; }
}

.footer {
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: 1px solid var(--line);
}

.subtotalRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-3);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.rail .actions {
  flex-direction: column;
  align-items: stretch;
  gap: var(--space-2);
}
```

- [ ] **Step 3: Replace `apps/pos/src/pages/Cart.tsx` body**

```tsx
import { useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { IconButton } from '@2990s/design-system';
import { CartContents } from '../components/CartContents';
import { Topbar } from '../components/Topbar';
import styles from './Cart.module.css';

export const Cart = () => {
  const navigate = useNavigate();
  return (
    <>
      <Topbar step="cart" />
      <main className={styles.shell}>
        <header className={styles.header}>
          <IconButton
            icon={<ArrowLeft size={20} strokeWidth={1.75} />}
            aria-label="Back"
            onClick={() => navigate('/catalog')}
          />
          <h1 className={styles.heading}>Cart</h1>
        </header>
        <CartContents variant="page" onContinue={() => navigate('/handover')} />
      </main>
    </>
  );
};
```

- [ ] **Step 4: Trim `apps/pos/src/pages/Cart.module.css`**

Keep only the page-chrome rules (`.shell`, `.header`, `.heading`). Delete the cart-internal rules that moved to `CartContents.module.css`. Result:

```css
.shell {
  min-height: 100vh;
  background: var(--bg);
  padding: var(--space-5) var(--space-6);
  max-width: 920px;
  margin: 0 auto;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}

.heading {
  font-family: var(--font-title);
  font-weight: var(--w-bold);
  font-size: var(--fs-32);
  margin: 0;
}
```

(Everything else from the old `Cart.module.css` is now in `CartContents.module.css`.)

- [ ] **Step 5: Run typecheck**

```bash
pnpm --filter @2990s/pos typecheck
```

Expected: no errors. The unused imports in old `Cart.tsx` (`useState`, `Link`, `Trash2`, `BookmarkPlus`, `Check`, `useCart`, `cartSubtotal`, `CartLine`, `useSaveQuote`, `Button`, `PriceTag`, `fmtRM`) are gone; only `useNavigate`, `ArrowLeft`, `IconButton`, `CartContents`, `Topbar`, `styles` remain.

- [ ] **Step 6: Smoke `/cart` route**

Start dev server: `pnpm --filter @2990s/pos dev`. Open `http://localhost:6273`, log in, add a few items via Catalog → Configurator, navigate to `/cart`. Verify the cart page renders identically to before this task: line list, qty steppers, subtotal, "Continue to handover" button. No visual regression.

- [ ] **Step 7: Commit**

```bash
git add apps/pos/src/components/CartContents.tsx \
        apps/pos/src/components/CartContents.module.css \
        apps/pos/src/pages/Cart.tsx \
        apps/pos/src/pages/Cart.module.css
git commit -m "refactor(pos): extract CartContents from Cart.tsx for reuse — desktop pass prep"
```

---

## Task 4: `<CartRail>` component

A 320px sticky right-side panel that wraps `<CartContents variant="rail" />` with a header and rail-specific positioning. Renders nothing if cart is empty (delegates to `CartContents` empty state, which shows "Cart is empty · Browse catalog").

**Files:**
- Create: `apps/pos/src/components/CartRail.tsx`
- Create: `apps/pos/src/components/CartRail.module.css`

- [ ] **Step 1: Create `apps/pos/src/components/CartRail.tsx`**

```tsx
import { useNavigate } from 'react-router';
import { useCart, cartItemCount } from '../state/cart';
import { CartContents } from './CartContents';
import styles from './CartRail.module.css';

export const CartRail = () => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);

  return (
    <aside className={styles.rail} aria-label="Cart">
      <header className={styles.header}>
        <span className={styles.headerTitle}>Cart</span>
        {count > 0 && <span className={styles.headerCount}>{count}</span>}
      </header>
      <div className={styles.body}>
        <CartContents variant="rail" onContinue={() => navigate('/handover')} />
      </div>
    </aside>
  );
};
```

- [ ] **Step 2: Create `apps/pos/src/components/CartRail.module.css`**

```css
.rail {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  position: sticky;
  top: var(--space-3);
  max-height: calc(100vh - var(--space-7));
  overflow-y: auto;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-2) var(--space-2);
  border-bottom: 1px solid var(--line);
}

.headerTitle {
  font-family: var(--font-button);
  font-size: var(--fs-13);
  font-weight: var(--w-bold);
  letter-spacing: var(--tk-loud);
  text-transform: uppercase;
  color: var(--fg);
}

.headerCount {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: var(--c-burnt);
  color: var(--c-cream);
  border-radius: var(--radius-pill);
  font-family: var(--font-button);
  font-size: var(--fs-11);
  font-weight: var(--w-bold);
}

.body {
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @2990s/pos typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/CartRail.tsx apps/pos/src/components/CartRail.module.css
git commit -m "feat(pos): CartRail component — sticky right-side cart panel for desktop"
```

---

## Task 5: Mount `<CartRail>` in Catalog + Catalog desktop layout block

Wire the hook + component into Catalog. The catalog layout grid gets a third column at desktop; `<CartRail/>` mounts in it.

**Files:**
- Modify: `apps/pos/src/pages/Catalog.tsx`
- Modify: `apps/pos/src/pages/Catalog.module.css`

- [ ] **Step 1: Update `apps/pos/src/pages/Catalog.tsx`**

Add the hook + import + mount. Diff against current `Catalog.tsx`:

Add to imports near the top (line 22):

```tsx
import { useMediaQuery } from '../hooks/useMediaQuery';
import { CartRail } from '../components/CartRail';
```

Inside the `Catalog` component, after the existing `useState` calls (around line 56):

```tsx
  const isDesktop = useMediaQuery(
    '(min-width: 1280px) and (hover: hover) and (pointer: fine)',
  );
```

Then in the JSX, change the layout `<div className={styles.layout}>` block to render the rail when desktop. Replace lines ~134–245 (the existing 2-col `<div className={styles.layout}>...<aside>...<section>...</section></div>` block) with:

```tsx
        <div className={`${styles.layout} ${isDesktop ? styles.layoutDesktop : ''}`}>
          {/* ─── Left rail ─── */}
          <aside className={styles.sidebar}>
            {/* unchanged sidebar JSX from current Catalog.tsx */}
          </aside>

          {/* ─── Main grid ─── */}
          <section className={styles.main}>
            {/* unchanged main JSX from current Catalog.tsx */}
          </section>

          {/* ─── Cart rail (desktop only) ─── */}
          {isDesktop && <CartRail />}
        </div>
```

**Important:** Do NOT delete or alter the sidebar contents or the main grid contents. Only:
1. Add the conditional class on `.layout`.
2. Add `{isDesktop && <CartRail />}` as a sibling after the `<section>` close.

The full current sidebar/section JSX (lines 136–243) stays verbatim.

- [ ] **Step 2: Add desktop block to `apps/pos/src/pages/Catalog.module.css`**

Append at the bottom of the file (after the existing `@media (max-width: 880px)` block):

```css
/* ─── Desktop layout (≥1280 + hover + fine pointer) ─── */
@media (min-width: 1280px) and (hover: hover) and (pointer: fine) {
  .layoutDesktop {
    grid-template-columns: 240px 1fr 320px;
    gap: var(--space-5);
  }
}
```

The existing default `.layout { grid-template-columns: 240px 1fr; gap: var(--space-5) }` stays intact for tablet.

- [ ] **Step 3: Run typecheck**

```bash
pnpm --filter @2990s/pos typecheck
```

Expected: no errors.

- [ ] **Step 4: Smoke `/catalog` at both viewports**

Start dev server (`pnpm --filter @2990s/pos dev`). In browser:

- **iPad emulation 1180×820 (or actual iPad).** No CartRail. Layout matches before this task.
- **FHD desktop 1920×1080 (real window or browser at fullscreen).** CartRail visible on right; product grid auto-fills the middle lane (~5 columns natural at 1280px main width).
- **Drag window across 1280 threshold.** Rail appears/disappears smoothly. Cart contents preserved (Zustand store).
- **Click rail "Continue to handover" with items in cart.** Navigates to `/handover`.

If you can't drag a real window, use Chrome DevTools device emulation: toggle between "Responsive 1180×820" and "Responsive 1920×1080".

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/pages/Catalog.tsx apps/pos/src/pages/Catalog.module.css
git commit -m "feat(pos): mount CartRail on Catalog at desktop breakpoint — desktop pass step 1"
```

---

## Task 6: Topbar density tweak at desktop

The Topbar component is shared across pages. At desktop, mouse precision allows the iconBtn to shrink from 36px to 32px. Brand-spec preserves the 28px avatar at all breakpoints.

**Files:**
- Modify: `apps/pos/src/components/Topbar.module.css`

- [ ] **Step 1: Append desktop block to `Topbar.module.css`**

Add to the bottom of the file:

```css
/* ─── Desktop density (≥1280 + hover + fine pointer) ─── */
@media (min-width: 1280px) and (hover: hover) and (pointer: fine) {
  .iconBtn {
    width: 32px;
    height: 32px;
  }
  .staffRole {
    font-size: 10px;
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm --filter @2990s/pos typecheck
```

Expected: no errors.

- [ ] **Step 3: Smoke /catalog topbar at FHD**

Start dev server, open in FHD window. Hover the topbar buttons — should feel slightly tighter than tablet but still comfortably clickable. iPad still shows 36px (unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/components/Topbar.module.css
git commit -m "feat(pos): Topbar density tweak at desktop breakpoint"
```

---

## Task 7: UI_REFERENCE.md §3 deviation entry

Document the desktop layout extension as a formal approved deviation. Future contributors reading `UI_REFERENCE.md` should see this and know desktop is a first-class target.

**Files:**
- Modify: `UI_REFERENCE.md`

- [ ] **Step 1: Find the "Approved deviations" section**

Open `UI_REFERENCE.md`. Locate the `## Approved deviations from prototype` heading. The current file has `### §1` (per-Model pricing) and `### §2` (multi-showroom). The new entry goes after §2.

- [ ] **Step 2: Append §3 block**

Insert after the `### §2 · Multi-showroom support` block (which ends with the bullet about coordinator drawer + dashboard getting a showroom filter chip), before the next `---` horizontal rule:

```markdown
### §3 · POS desktop layout (≥1280px hover-and-pointer:fine)

**Approved on:** 2026-05-10
**Status:** Implementation plan at `docs/superpowers/plans/2026-05-11-pos-desktop-view.md`. Spec at `docs/superpowers/specs/2026-05-10-pos-desktop-view-design.md`.

**What changed:**
- POS gains a desktop breakpoint at `min-width:1280px` with `hover:hover` + `pointer:fine` guards. iPad Pro 12.9" without keyboard stays on tablet layout; with Magic Keyboard (or any pointing device) triggers desktop.
- Catalog: `<CartRail/>` mounts as a 320px right-side sticky panel at desktop. Layout grid changes from `240px 1fr` to `240px 1fr 320px`. Product grid auto-fills the middle lane.
- Topbar: iconBtn shrinks from 36px to 32px at desktop. Avatar 28px and 44px touch targets preserved on tablet.
- Cart route: refactored — `Cart.tsx` becomes a thin route wrapper around new `<CartContents variant="page"/>`. The same `<CartContents variant="rail"/>` powers the rail. No behavior change to `/cart` page.
- Sofa configurator + CustomBuilder: explicitly untouched per `CLAUDE.md` red line #2. `1100px` max-width centered preserved on FHD.
- Handover: already responsive (default `.fieldRow` is 2-col grid). No changes needed.

**New code:** `apps/pos/src/hooks/useMediaQuery.ts` (+ test), `apps/pos/src/components/CartContents.tsx` + `.module.css` (extracted from `Cart.tsx`), `apps/pos/src/components/CartRail.tsx` + `.module.css`. New vitest + jsdom + `@testing-library/react` test infra in `apps/pos`.

**Not changed:** `prototype/` files (tablet-canonical and not desktop-aware), PWA manifest (`orientation: 'landscape'` is a no-op in desktop browsers), design tokens, routes, schema, API contracts.
```

- [ ] **Step 3: Commit**

```bash
git add UI_REFERENCE.md
git commit -m "docs(ui-reference): §3 POS desktop layout deviation entry"
```

---

## Task 8: Visual regression check via gstack `/browse`

Run `/browse` against the POS dev server at both viewports for every page. Verify nothing regressed on tablet and the desktop changes look right on FHD.

**Files:**
- None (verification only)

- [ ] **Step 1: Start POS dev server**

```bash
pnpm --filter @2990s/pos dev
```

Note the port (default 6273; check actual stdout). For the rest of this task assume `http://localhost:6273`.

- [ ] **Step 2: Tablet viewport regression sweep**

Use gstack `/browse` to navigate each page at viewport 1180×820 and screenshot. Compare against pre-PR screenshots if available, otherwise eyeball for visual integrity:

- `/login`
- `/catalog`
- `/configure/<some-product-id>`
- `/cart`
- `/handover`
- `/orders/<some-order-id>` (a real order or seed one)
- `/my-orders`
- `/quotes`

Expected: all pages look identical to before this PR. Most importantly:
- `/catalog` does NOT show CartRail at 1180×820.
- `/configure` and the custom builder are untouched (1100px centered).
- Topbar iconBtn is 36px (the original tablet size).

- [ ] **Step 3: Desktop viewport sweep**

Same pages at viewport 1920×1080. Verify:

- `/catalog` shows the 240px sidebar + product grid + 320px CartRail (right). Rail header reads "Cart" with item count badge.
- `/configure` and `/custom-builder` remain 1100px centered with whitespace either side. **No CartRail.**
- `/cart` page renders identically to before (uses `CartContents variant="page"`). **No CartRail** (avoided to prevent double-cart).
- `/handover` form fields lay out 2-col / 3-col (`.fieldRow` / `.fieldRow3`) as they already did at tablet ≥881px. Right-side order summary panel intact.
- Topbar iconBtn is 32px on desktop only.

- [ ] **Step 4: Cart state survives breakpoint cross**

Open `/catalog` at 1180×820. Add 2 cart items. Resize the window to 1920×1080 (or use DevTools device emulator to switch). CartRail appears on the right showing the same 2 items.

Resize back to 1180×820. CartRail disappears. Items stay in cart (Topbar cart pill still shows count 2, `/cart` route still has the items).

- [ ] **Step 5: Documentation note**

If any unexpected regression is found, file a bug in `docs/known-issues/` with screenshots and stop. Do not "fix and proceed silently."

- [ ] **Step 6: No commit**

This task produces no code changes; it's a verification gate before merge.

---

## Self-Review

**1. Spec coverage:** Walked through `docs/superpowers/specs/2026-05-10-pos-desktop-view-design.md`:

| Spec section | Implementation | Notes |
|---|---|---|
| §1.1 What we're building | Tasks 2, 3, 4, 5 | Complete |
| §1.2 Out of scope | n/a | Honored — Configurator, CustomBuilder, etc. untouched |
| §2.1 Breakpoint strategy | Task 5 (Catalog), Task 6 (Topbar) | Both use the exact `(min-width: 1280px) and (hover: hover) and (pointer: fine)` query |
| §2.2 New files | Tasks 1, 2, 3, 4 | Vitest infra (Task 1) was implicit in spec; surfaced explicitly here |
| §2.3 Modified CSS files | Tasks 3, 5, 6 | Cart.module.css trimmed (Task 3) — internals moved to CartContents |
| §3.1 useMediaQuery | Task 2 | TDD with 4 tests |
| §3.2 CartRail | Task 4 | Reuses CartContents |
| §3.3 CartContents | Task 3 | Refactor extraction |
| §4.1 Catalog | Task 5 | 3-col layout + conditional rail |
| §4.2 Handover | **Skipped** | Spec correction #2 — already responsive |
| §4.3 Topbar | Task 6 | iconBtn 36→32 |
| §4.4 Cart route | Task 3 (no further change) | Refactor only; no max-width tweak |
| §4.5 OrderConfirmed/Status/Quotes | **Skipped** | Spec correction #3 — already adequate |
| §4.6 Login | Skipped (intentional) | Already centered, no change |
| §4.7 Configurator + CustomBuilder | Skipped (red line #2) | Honored |
| §5 Data flow | n/a | No state changes |
| §6 Edge cases | Task 8 | Verified by viewport sweep |
| §7 Testing strategy | Tasks 2, 8 | Hook unit + visual regression |
| §8 Deviation log | Task 7 | UI_REFERENCE.md §3 entry |
| §10 Acceptance criteria | All tasks 1–8 | Each acceptance item maps to a verify step |

**2. Placeholder scan:** Searched the plan for "TBD", "TODO", "implement later", "appropriate error handling", "similar to". None found. Each task has full code or full file paths and exact commands.

**3. Type consistency:**
- `useMediaQuery(query: string): boolean` — same signature in Task 2 (definition) and Task 5 (usage).
- `CartContentsVariant = 'page' | 'rail'` — defined in Task 3, used in Task 4 (`variant="rail"`) and in Task 3 (`variant="page"`).
- `CartContents` props `{ variant, onContinue }` — same shape in Tasks 3 and 4.
- `cartItemCount(lines)` (used in Task 4) — already exported from `apps/pos/src/state/cart.ts:108` (verified in code reading).
- All file paths use exact-case Windows paths internally but specify POSIX-style in commands; this is standard in this repo's other plans.

**4. Scope check:** 8 tasks, ~3–4 days work. Tight enough for a single PR. Could split into two if needed (Tasks 1–4 = "infra + extraction", Tasks 5–8 = "wiring + verify"), but cohesion is high; single PR is fine.

---

## Acceptance gate (mirrors spec §10)

After all 8 tasks land:

- [ ] FHD 1920×1080 `/catalog` shows sidebar + product grid + CartRail.
- [ ] iPad 10.9" landscape (1180×820) `/catalog` looks identical to before this PR.
- [ ] iPad Pro 12.9" no keyboard: tablet layout (pointer:fine guard correctly excludes).
- [ ] iPad Pro 12.9" + Magic Keyboard: desktop layout (manual verify if device available; otherwise rely on the matchMedia query semantics).
- [ ] Cart contents survive window resize across 1280px in either direction.
- [ ] `pnpm typecheck` passes 6/6 workspaces.
- [ ] `pnpm --filter @2990s/pos test` passes — useMediaQuery 4/4 green.
- [ ] `UI_REFERENCE.md` has a §3 deviation entry.
- [ ] No regressions on `/configure`, `/custom-builder` (red-lined surfaces).
