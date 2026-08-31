// Regression cover for the 2026-08-31 production crash.
//
// The Products tab read `m.demographics.n` and `v.demographics` as though the
// server always sent them. Houzs strips both from every model and variant, so
// opening the tab on pos.2990shome.com killed the whole route with
//     TypeError: Cannot read properties of undefined (reading 'n')
// and the router's error boundary replaced the page.
//
// The first test builds the payload Houzs ACTUALLY ships — demographics and
// margin removed with a rest-destructure, so the keys are ABSENT rather than
// null, exactly as they arrive over the wire — and asserts the tab renders.
// Before the fix it throws.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

import { ProductsTab } from './ProductsTab';
import type {
  WireModelRank, WireProductsSection, WireVariantRank,
} from '../../lib/sales-analysis-queries';

const variant = (over: Partial<WireVariantRank> = {}): WireVariantRank => ({
  label: 'Queen',
  units: 3,
  revenueCenti: 300_00,
  demographics: { n: 3, race: [], ageBand: [], gender: [] },
  ...over,
});

const model = (over: Partial<WireModelRank> = {}): WireModelRank => ({
  modelId: 'm1',
  modelName: 'BLATT',
  category: 'SOFA',
  units: 5,
  revenueCenti: 500_00,
  marginCenti: 100_00,
  variants: [variant()],
  demographics: { n: 5, race: [], ageBand: [], gender: [] },
  comboUnits: 0,
  customUnits: 0,
  pwpUnits: 0,
  fabricUpgradeUnits: 0,
  fabricEligibleUnits: 0,
  ...over,
});

/** Strip exactly what Houzs strips: demographics off the model and each of its
 *  variants. The keys end up absent, not null. */
const asHouzsShips = (m: WireModelRank): WireModelRank => {
  const { demographics: _d, ...rest } = m;
  return {
    ...rest,
    variants: m.variants.map((v) => {
      const { demographics: _vd, ...vr } = v;
      return vr;
    }),
  };
};

const section = (models: WireModelRank[]): WireProductsSection => ({
  byCategory: { SOFA: models },
});

describe('ProductsTab', () => {
  it('renders when the server omits demographics (the 2026-08-31 crash)', () => {
    render(<ProductsTab products={section([asHouzsShips(model())])} />);

    // The tab is alive and showing the model. getAllByText, not getByText: the
    // name legitimately appears in the rank row, the detail head and the
    // narrow-viewport <select> option.
    expect(screen.getAllByText('BLATT').length).toBeGreaterThan(0);
    expect(screen.getByText('Queen')).toBeInTheDocument();
    // …and says why the buyers block is missing, instead of drawing an empty one.
    expect(screen.getByText('Buyer demographics unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/^Buyers \(n =/)).not.toBeInTheDocument();
  });

  it('still renders the buyers block when demographics ARE present', () => {
    render(<ProductsTab products={section([model()])} />);
    expect(screen.getByText('Buyers (n = 5)')).toBeInTheDocument();
    expect(screen.queryByText('Buyer demographics unavailable')).not.toBeInTheDocument();
  });

  it("shows '—' rather than 0.0% when the server withheld margin", () => {
    const { marginCenti: _m, ...gated } = model();
    render(<ProductsTab products={section([gated])} />);
    // The category facts block prints Margin; with no margin it must not read 0.0%.
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('handles a model with no variants at all', () => {
    render(<ProductsTab products={section([asHouzsShips(model({ variants: [] }))])} />);
    expect(screen.getByText('No variant detail.')).toBeInTheDocument();
  });

  it('renders the empty state for a products section with no categories', () => {
    render(<ProductsTab products={{ byCategory: {} }} />);
    expect(screen.getByText('No product sales in this view.')).toBeInTheDocument();
  });
});
