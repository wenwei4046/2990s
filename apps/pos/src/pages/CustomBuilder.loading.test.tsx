import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import type { Cell, SofaProductPricing } from '@2990s/shared';
import type { FabricColourRow, FabricLibraryRow, SofaCustomizerData } from '../lib/queries';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: null }), isGlobalCurator: () => false }));
import { CustomBuilder } from './CustomBuilder';
import { useCart } from '../state/cart';

beforeAll(() => {
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      value: class { observe() {} unobserve() {} disconnect() {} },
    });
  }
  const proto = window.HTMLDialogElement?.prototype;
  if (proto && typeof proto.close !== 'function') {
    proto.close = function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
    proto.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  }
});

const clients: QueryClient[] = [];
beforeEach(() => { useCart.setState({ lines: [] }); });
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

const PRODUCT_ID = 'mfg-loading-sofa';
const PRICING: SofaProductPricing = {
  compartments: [
    { compartmentId: '1A(LHF)', active: true, priceSen: 199_000 },
    { compartmentId: '2A(RHF)', active: true, priceSen: 299_000 },
  ],
  bundles: [], reclinerUpgradeSen: 0, seatUpgradeLabel: null, combos: [],
};
const FABRICS: FabricLibraryRow[] = [
  { id: 'cloud', label: 'Cloud Grey', tier: 'standard', defaultSurcharge: 0,
    active: true, sortOrder: 0, sofaTier: 'PRICE_1', bedframeTier: 'PRICE_1' },
  { id: 'linen', label: 'Linen', tier: 'standard', defaultSurcharge: 0,
    active: true, sortOrder: 1, sofaTier: 'PRICE_1', bedframeTier: 'PRICE_1' },
];
const COLOURS: FabricColourRow[] = [
  { fabricId: 'cloud', colourId: 'CG-001', label: 'Stone', swatchHex: '#aaa', active: true, sortOrder: 0 },
  { fabricId: 'linen', colourId: 'LN-001', label: 'Sand', swatchHex: '#ddd', active: true, sortOrder: 1 },
];
const CUSTOMIZER: SofaCustomizerData = {
  compartments: PRICING.compartments.map((c) => ({
    code: c.compartmentId, normalizedCode: c.compartmentId, label: c.compartmentId,
    priceSen: c.priceSen, imageUrl: null,
    group: c.compartmentId.startsWith('1') ? '1-seater' : '2-seater',
  })),
  sellingRows: [], sizes: ['24'], legHeights: [], specials: [], fabricIds: ['CG-001'],
  accessories: [], accessoriesNeeded: [], modelId: 'sofa-model', modelName: 'TANNAH', modelCode: 'TANNAH',
};
const closedCells = (): Cell[] => [
  { id: 'a', moduleId: '1A(LHF)', x: 100, y: 100, rot: 0 },
  { id: 'b', moduleId: '2A(RHF)', x: 195, y: 100, rot: 0 },
];

type Props = ComponentProps<typeof CustomBuilder>;
const mount = (overrides: Partial<Props> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  client.setQueryData(['fabric-library'], FABRICS);
  client.setQueryData(['fabric-colours'], COLOURS);
  client.setQueryData(['product', PRODUCT_ID, 'fabrics'], []);
  client.setQueryData(['fabric-tier-addon-config'], {
    sofaTier2Delta: 100, sofaTier3Delta: 200, bedframeTier2Delta: 100, bedframeTier3Delta: 200,
  });
  client.setQueryData(['model-fabric-tier-overrides'], []);
  client.setQueryData(['compartment-fabric-tier-overrides'], []);
  const setCells = vi.fn();
  const onFabricChange = vi.fn();
  let props: Props = {
    productId: PRODUCT_ID, productName: 'TANNAH', pricing: PRICING, depth: '24',
    cells: [], setCells, onAdded: vi.fn(), onFabricChange, ...overrides,
  };
  const tree = () => <QueryClientProvider client={client}><CustomBuilder {...props} /></QueryClientProvider>;
  const view = render(tree());
  return {
    setCells, onFabricChange,
    rerender: (next: Partial<Props>) => { props = { ...props, ...next }; view.rerender(tree()); },
  };
};

describe('CustomBuilder initial module and fabric loading', () => {
  it('distinguishes pending options from a genuinely empty fabric configuration', () => {
    const view = mount({ modelCustomizerState: 'pending' });
    expect(screen.getByText('Loading modules…')).toBeInTheDocument();
    expect(screen.getByText('Loading fabrics…')).toBeInTheDocument();
    expect(screen.queryByText('No fabrics enabled for this Model.')).not.toBeInTheDocument();
    const canvasHeading = screen.getByText('Custom build · drag to lay out');

    view.rerender({ modelCustomizerState: 'ready', modelCustomizer: { ...CUSTOMIZER, fabricIds: [] } });
    expect(screen.queryByText('Loading modules…')).not.toBeInTheDocument();
    expect(screen.getByText('No fabrics enabled for this Model.')).toBeInTheDocument();
    expect(screen.getByText('Custom build · drag to lay out')).toBe(canvasHeading);
    fireEvent.click(screen.getByText('1A(LHF)').closest('button')!);
    expect(view.setCells).toHaveBeenCalled();
  });

  it('offers the model fabric from the product response before module prices arrive', () => {
    const view = mount({ modelCustomizerState: 'pending', enabledFabricCodes: ['CG-001'] });
    expect(screen.getByText('Loading modules…')).toBeInTheDocument();
    expect(screen.queryByText('No fabrics enabled for this Model.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Linen/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cloud Grey/ }));
    expect(view.onFabricChange).toHaveBeenCalledWith(expect.objectContaining({ fabricId: 'cloud', colourId: 'CG-001' }));
  });

  it('shows a retryable failure instead of claiming the model has no fabrics', () => {
    const retry = vi.fn();
    mount({ modelCustomizerState: 'error', onRetryCustomizer: retry });
    expect(screen.getByText('Could not load modules.')).toBeInTheDocument();
    expect(screen.getByText('Could not load fabrics.')).toBeInTheDocument();
    expect(screen.queryByText('No fabrics enabled for this Model.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it.each(['pending', 'error'] as const)('prevents a restored closed build being sold while options are %s', (state) => {
    const view = mount({ modelCustomizerState: state, cells: closedCells() });
    const add = screen.getByRole('button', { name: 'Add to cart' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(useCart.getState().lines).toHaveLength(0);

    view.rerender({ modelCustomizerState: 'ready', modelCustomizer: CUSTOMIZER });
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  it('waits for selling prices before adding a restored build even when modules are ready', () => {
    const view = mount({
      modelCustomizerState: 'ready', modelCustomizer: CUSTOMIZER,
      cells: closedCells(), sellingDataReady: false,
    });
    const add = screen.getByRole('button', { name: 'Add to cart' });
    expect(screen.queryByText('Loading modules…')).not.toBeInTheDocument();
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(useCart.getState().lines).toHaveLength(0);

    view.rerender({ sellingDataReady: true });
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  it('keeps already resolved modules and fabric usable when the parent retains cached data', () => {
    mount({ modelCustomizerState: 'ready', modelCustomizer: CUSTOMIZER, cells: closedCells() });
    expect(screen.queryByText('Loading modules…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cloud Grey/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });
});
