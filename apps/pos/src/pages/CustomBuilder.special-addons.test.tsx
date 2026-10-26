import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cell, SofaProductPricing } from '@2990s/shared';
import type { SpecialAddonRow } from '../lib/queries';
import type { SpecialSel } from '../components/SpecialAddonsPicker';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: null }), isGlobalCurator: () => false }));
import { CustomBuilder } from './CustomBuilder';
import { useCart, type SofaConfigSnapshot } from '../state/cart';
import { cellsFromComboModules } from '../lib/sofa-combo-cells';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class { observe() {} unobserve() {} disconnect() {} },
    });
  }
  const proto = window.HTMLDialogElement?.prototype as unknown as Record<string, unknown> | undefined;
  if (proto && typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
    proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  }
});
beforeEach(() => { useCart.setState({ lines: [] }); });
afterEach(cleanup);

const PRICING: SofaProductPricing = {
  compartments: [
    { compartmentId: '1B(LHF)', active: true, priceSen: 199_000 },
    { compartmentId: '1A(LHF)', active: true, priceSen: 199_000 },
    { compartmentId: 'CNR', active: true, priceSen: 149_000 },
    { compartmentId: '2A(RHF)', active: true, priceSen: 299_000 },
  ],
  bundles: [], reclinerUpgradeSen: 0, seatUpgradeLabel: null, combos: [],
};

/* Owner 2026-10-26: an add-on detects the sofa's compartments, like the
   per-compartment fabric prices — a corner sofa takes the corner price. */
const LATEX: SpecialAddonRow = {
  id: 'sa-latex', code: 'Latex Seat', label: 'Latex Seat', soDescription: 'Latex seat',
  categories: ['SOFA'], sellingPriceSen: 50_000, costPriceSen: 0, optionGroups: [],
  compartmentPrices: [{ compartment: 'CNR', sellingPriceSen: 80_000 }],
  active: true, sortOrder: 0,
};
const PICKED: SpecialSel[] = [{ id: 'Latex Seat', label: 'Latex Seat', surcharge: 500, choices: [] }];

const corner = (): Cell[] => cellsFromComboModules([['1B(LHF)'], ['CNR'], ['2A(RHF)']], '24');
const straight = (): Cell[] => [
  { id: 'a', moduleId: '1A(LHF)', x: 100, y: 100, rot: 0 },
  { id: 'b', moduleId: '2A(RHF)', x: 195, y: 100, rot: 0 },
];

const mount = (cells: Cell[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomBuilder
        productId="" productName="BOOQIT" pricing={PRICING} depth="24"
        cells={cells} setCells={vi.fn()} onAdded={() => {}}
        specialAddons={[LATEX]} specialSel={PICKED} onSpecialSelChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

const addedLine = (): SofaConfigSnapshot => {
  fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
  const lines = useCart.getState().lines;
  expect(lines).toHaveLength(1);
  return lines[0]!.config as SofaConfigSnapshot;
};

describe('CustomBuilder · Special Add-ons by compartment', () => {
  it('a sofa with a corner shows and charges the corner price', () => {
    mount(corner());
    expect(screen.getByRole('button', { name: /Latex Seat/ })).toHaveTextContent('+RM 800');
    const line = addedLine();
    expect(line.specialIds).toEqual(['Latex Seat']);
    expect(line.specialChoices).toEqual({ 'Latex Seat': [] });
    // 1B 1,990 + CNR 1,490 + 2A 2,990, plus the corner price.
    expect(line.total).toBe(1990 + 1490 + 2990 + 800);
  });

  it('a sofa without the compartment keeps the base price', () => {
    mount(straight());
    expect(screen.getByRole('button', { name: /Latex Seat/ })).toHaveTextContent('+RM 500');
    expect(addedLine().total).toBe(1990 + 2990 + 500);
  });
});
