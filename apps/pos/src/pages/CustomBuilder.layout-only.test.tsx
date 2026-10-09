import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Cell, SofaProductPricing } from '@2990s/shared';

// The canvas needs no backend; prevent API clients from initialising real sessions.
vi.mock('../lib/supabase', () => ({ supabase: {} }));
// Only Quick Pick / Combo curation reads the signed-in staff; no session here.
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: null }), isGlobalCurator: () => false }));
import { CustomBuilder } from './CustomBuilder';

beforeAll(() => {
  // jsdom has no ResizeObserver; the canvas only uses it to fit the stage.
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class { observe() {} unobserve() {} disconnect() {} },
    });
  }
  // Nor <dialog>'s methods; the palette rail is a <dialog> kept open on tablet.
  const proto = window.HTMLDialogElement?.prototype as unknown as Record<string, unknown> | undefined;
  if (proto && typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
    proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  }
});
afterEach(cleanup);

/** One priced module, so the selling palette has a price to show and the
 *  layout-only one has a price to hide. */
const PRICING: SofaProductPricing = {
  compartments: [{ compartmentId: '1A(LHF)', active: true, priceSen: 199_000 }],
  bundles: [], reclinerUpgradeSen: 0, seatUpgradeLabel: null, combos: [],
};

/** 1A(LHF) + 2NA + L(RHF), flush in a row at 24": a closed 3+L that is NOT the
 *  bundle's canonical breakdown (2A(LHF) + 1NA + L(RHF)) — exactly what the
 *  selling canvas's auto-convert rewrites so a combo price matches. */
const threePlusL = (): Cell[] => [
  { id: 'a', moduleId: '1A(LHF)', x: 100, y: 100, rot: 0 },
  { id: 'b', moduleId: '2NA', x: 195, y: 100, rot: 0 },
  { id: 'c', moduleId: 'L(RHF)', x: 337, y: 100, rot: 0 },
];

const mount = (layoutOnly?: { railBlock?: ReactNode }) => {
  const setCells = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <CustomBuilder
        productId=""
        productName=""
        pricing={PRICING}
        depth="24"
        cells={threePlusL()}
        setCells={setCells}
        onAdded={() => {}}
        layoutOnly={layoutOnly}
      />
    </QueryClientProvider>,
  );
  return { setCells, container };
};

/* Owner 2026-10-09: Marketing lays out a sofa to BUY on the same canvas —
   same drag / snap / rotate / edit — but nothing that sells, and never the
   auto-convert to a combo's breakdown ("that is for matching combo pricing;
   this is for procurement"). */
describe('CustomBuilder in layoutOnly mode (Marketing)', () => {
  it('leaves the compartments as laid out', () => {
    const { setCells } = mount({ railBlock: <div>Marketing rail</div> });
    expect(setCells).not.toHaveBeenCalled();
  });

  it('shows no price, no price bar and no fabric picker — its own rail instead', () => {
    const { container } = mount({ railBlock: <div>Marketing rail</div> });
    expect(screen.getByText('Marketing rail')).toBeInTheDocument();
    expect(container.querySelector('footer')).toBeNull();
    expect(screen.getByText('1A(LHF)')).toBeInTheDocument();   // the module is offered…
    expect(screen.queryAllByText(/1,990/)).toHaveLength(0);     // …without its price
    expect(screen.queryByText(/Save as Quick Pick/)).toBeNull();
    // Still the same canvas.
    expect(screen.getByText('Custom build · drag to lay out')).toBeInTheDocument();
  });
});

describe('CustomBuilder selling (unchanged)', () => {
  it('still rewrites the build into the canonical breakdown', () => {
    const { setCells } = mount();
    expect(setCells).toHaveBeenCalled();
  });

  it('still prices the palette and shows the price bar', () => {
    const { container } = mount();
    expect(container.querySelector('footer')).not.toBeNull();
    expect(screen.queryAllByText(/1,990/).length).toBeGreaterThan(0);
  });
});
