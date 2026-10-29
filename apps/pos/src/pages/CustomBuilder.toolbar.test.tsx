import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import type { Cell, SofaProductPricing } from '@2990s/shared';
import type { FabricColourRow, FabricLibraryRow, SofaCustomizerData } from '../lib/queries';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: null }), isGlobalCurator: () => false }));
vi.mock('../lib/houzs-perms', () => ({ useMaintainAccess: () => ({ canMaintain: false, isLoading: false }) }));
import { CustomBuilder } from './CustomBuilder';
import { useCart, type SofaConfigSnapshot } from '../state/cart';

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
const targets: HTMLElement[] = [];
beforeEach(() => { useCart.setState({ lines: [] }); });
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  targets.splice(0).forEach((target) => target.remove());
});

const PRODUCT_ID = 'mfg-toolbar-sofa';
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
];
const COLOURS: FabricColourRow[] = [
  { fabricId: 'cloud', colourId: 'CG-001', label: 'Stone', swatchHex: '#aaa', active: true, sortOrder: 0 },
];
const CUSTOMIZER: SofaCustomizerData = {
  compartments: PRICING.compartments.map((c) => ({
    code: c.compartmentId, normalizedCode: c.compartmentId, label: c.compartmentId,
    priceSen: c.priceSen, imageUrl: null,
    group: c.compartmentId.startsWith('1') ? '1-seater' : '2-seater',
  })),
  sellingRows: [], sizes: ['24'], legHeights: [], specials: [], fabricIds: ['CG-001'],
  accessories: [], accessoriesNeeded: [], modelId: 'toolbar-model', modelName: 'TANNAH', modelCode: 'TANNAH',
};
const closedCells = (): Cell[] => [
  { id: 'a', moduleId: '1A(LHF)', x: 100, y: 100, rot: 0 },
  { id: 'b', moduleId: '2A(RHF)', x: 195, y: 100, rot: 0 },
];

type Props = ComponentProps<typeof CustomBuilder>;
function mount(overrides: Partial<Props> = {}) {
  const toolbar = document.createElement('div');
  document.body.append(toolbar);
  targets.push(toolbar);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  client.setQueryData(['fabric-library'], FABRICS);
  client.setQueryData(['fabric-colours'], COLOURS);
  client.setQueryData(['fabric-series-names'], []);
  client.setQueryData(['product', PRODUCT_ID, 'fabrics'], []);
  client.setQueryData(['fabric-tier-addon-config'], {
    sofaTier2Delta: 100, sofaTier3Delta: 200, bedframeTier2Delta: 100, bedframeTier3Delta: 200,
  });
  client.setQueryData(['model-fabric-tier-overrides'], []);
  client.setQueryData(['compartment-fabric-tier-overrides'], []);
  const onAdded = vi.fn();
  let props: Props = {
    toolbarTarget: toolbar,
    productId: PRODUCT_ID, productName: 'TANNAH', pricing: PRICING, depth: '24',
    cells: [], setCells: vi.fn(), onAdded,
    modelCustomizer: CUSTOMIZER, modelCustomizerState: 'ready', ...overrides,
  };
  const tree = () => <QueryClientProvider client={client}><CustomBuilder {...props} /></QueryClientProvider>;
  const view = render(tree());
  return {
    toolbar, container: view.container, onAdded,
    rerender: (next: Partial<Props>) => { props = { ...props, ...next }; view.rerender(tree()); },
  };
}

describe('CustomBuilder toolbar price placement', () => {
  it('shows one live price and action in the toolbar and adds the updated build once', () => {
    const view = mount();
    expect(within(view.toolbar).getByText('Provisional')).toBeInTheDocument();
    expect(within(view.toolbar).getByText('0')).toBeInTheDocument();
    expect(within(view.toolbar).getByRole('button', { name: 'Add modules to start' })).toBeDisabled();
    expect(view.container.querySelector('footer')).toBeNull();
    expect(view.toolbar.querySelector('footer')).toBeNull();

    view.rerender({ cells: closedCells(), extraAmountRm: 120 });
    expect(within(view.toolbar).getByText('Total')).toBeInTheDocument();
    expect(within(view.toolbar).getByText('5,100')).toBeInTheDocument();
    view.rerender({ extraAmountRm: 220 });
    expect(within(view.toolbar).getByText('5,200')).toBeInTheDocument();
    expect(within(view.toolbar).queryByText('5,100')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add to cart' })).toHaveLength(1);

    fireEvent.click(within(view.toolbar).getByRole('button', { name: 'Add to cart' }));
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(1);
    expect((lines[0]!.config as SofaConfigSnapshot).total).toBe(5200);
    expect(view.onAdded).toHaveBeenCalledOnce();
  });

  it('restores the footer without remounting the canvas or losing room and fabric choices', () => {
    const view = mount({ cells: closedCells() });
    const canvasHeading = screen.getByText('Custom build · drag to lay out');
    fireEvent.click(screen.getByRole('button', { name: /Cloud Grey/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand room' }));

    view.rerender({ toolbarTarget: null });
    expect(view.toolbar).toBeEmptyDOMElement();
    const footer = view.container.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(within(footer!).getByText('4,980')).toBeInTheDocument();
    expect(within(footer!).getByRole('button', { name: 'Add to cart' })).toBeEnabled();
    expect(screen.getByText('Custom build · drag to lay out')).toBe(canvasHeading);
    expect(screen.getByRole('button', { name: /Cloud Grey/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Reset room' })).toBeInTheDocument();

    view.rerender({ toolbarTarget: view.toolbar });
    expect(view.container.querySelector('footer')).toBeNull();
    expect(within(view.toolbar).getByText('4,980')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cloud Grey/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Reset room' })).toBeInTheDocument();
  });

  it('keeps the selling-data guard when the action is in the toolbar', () => {
    const view = mount({ cells: closedCells(), sellingDataReady: false });
    const add = within(view.toolbar).getByRole('button', { name: 'Add to cart' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(useCart.getState().lines).toHaveLength(0);
    view.rerender({ sellingDataReady: true });
    expect(within(view.toolbar).getByRole('button', { name: 'Add to cart' })).toBeEnabled();
  });

  it('does not expose selling controls for a layout-only canvas even with a target', () => {
    const view = mount({ cells: closedCells(), layoutOnly: { railBlock: <div>Marketing rail</div> } });
    expect(view.toolbar).toBeEmptyDOMElement();
    expect(view.container.querySelector('footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
    expect(screen.getByText('Marketing rail')).toBeInTheDocument();
  });
});
