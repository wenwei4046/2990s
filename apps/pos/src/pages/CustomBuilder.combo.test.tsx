import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import type { Cell, SofaProductPricing } from '@2990s/shared';
import { useCart } from '../state/cart';
import type { SofaAccessoryOption, PlacedAccessory } from '../lib/sofa-accessories';
import type { SofaComboRule } from '../lib/products/sofa-combos-queries';

const state = vi.hoisted(() => ({
  role: 'sales_director',
  canMaintain: true,
  combos: {
    data: [] as SofaComboRule[] | undefined,
    isPending: false,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  readCombos: vi.fn(),
  create: vi.fn(),
  saveShared: vi.fn(),
  savePersonal: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../lib/staff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/staff')>()),
  useStaff: () => ({ data: { role: state.role } }),
}));
// The real hook's role + Houzs resolved-permission rules are covered in
// houzs-perms.test.tsx. Here the canvas must consume that answer, even when
// Houzs reports the owner's legacy POS role as "sales".
vi.mock('../lib/houzs-perms', () => ({
  useMaintainAccess: () => ({ canMaintain: state.canMaintain, isLoading: false }),
}));
vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  useCreateSofaCombo: () => ({ mutateAsync: state.create, isPending: false }),
  useCreateSofaQuickPick: () => ({ mutateAsync: state.saveShared, isPending: false }),
}));
vi.mock('../lib/personal-quick-picks', () => ({ useAddPersonalQuickPick: () => ({ mutateAsync: state.savePersonal, isPending: false }) }));
vi.mock('../lib/products/sofa-combos-queries', () => ({
  useSofaCombos: (filters: unknown) => {
    state.readCombos(filters);
    return state.combos;
  },
}));
vi.mock('../lib/products/mfg-products-queries', () => ({
  useMaintenanceConfig: () => ({
    data: { data: { sofaSizes: ['24', '28', { value: '26', active: false }] } },
    isPending: false, isLoading: false, isError: false,
  }),
}));

import { CustomBuilder } from './CustomBuilder';
import { cellsFromComboModules } from '../lib/sofa-combo-cells';

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
beforeEach(() => {
  state.role = 'sales_director';
  state.canMaintain = true;
  state.combos.data = [];
  state.combos.isPending = false;
  state.combos.isLoading = false;
  state.combos.isError = false;
  state.combos.isFetching = false;
  state.combos.refetch.mockReset();
  state.readCombos.mockClear();
  state.create.mockReset().mockResolvedValue({ id: 'new-combo' });
  state.saveShared.mockReset().mockResolvedValue({ id: 'shared' });
  state.savePersonal.mockReset().mockResolvedValue({ id: 'personal' });
  useCart.setState({ lines: [] });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

const PRICING: SofaProductPricing = {
  compartments: [
    { compartmentId: '1A(LHF)', active: true, priceSen: 119_900 },
    { compartmentId: '2A(RHF)', active: true, priceSen: 195_363 },
  ],
  bundles: [], reclinerUpgradeSen: 0, seatUpgradeLabel: null, combos: [],
};
const closedCells = (): Cell[] => [
  { id: 'a', moduleId: '1A(LHF)', x: 100, y: 100, rot: 0 },
  { id: 'b', moduleId: '2A(RHF)', x: 195, y: 100, rot: 0 },
];

type Props = ComponentProps<typeof CustomBuilder>;
function mount(overrides: Partial<Props> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  clients.push(client);
  client.setQueryData(['fabric-library'], []);
  client.setQueryData(['fabric-colours'], []);
  client.setQueryData(['fabric-tier-addon-config'], {
    sofaTier2Delta: 0, sofaTier3Delta: 0, bedframeTier2Delta: 0, bedframeTier3Delta: 0,
  });
  client.setQueryData(['model-fabric-tier-overrides'], []);
  client.setQueryData(['compartment-fabric-tier-overrides'], []);
  let props: Props = {
    productId: '', productName: 'TANNAH', baseModel: 'TANNAH', pricing: PRICING,
    depth: '24', cells: closedCells(), setCells: vi.fn(), onAdded: vi.fn(), ...overrides,
  };
  const tree = () => <QueryClientProvider client={client}><CustomBuilder {...props} /></QueryClientProvider>;
  const view = render(tree());
  return {
    ...view,
    rerender: (next: Partial<Props> = {}) => { props = { ...props, ...next }; view.rerender(tree()); },
    open: () => {
      fireEvent.click(within(view.container.querySelector('footer')!).getByRole('button', { name: 'Add to Combo Price' }));
      return screen.getByRole('dialog', { name: 'Add to Combo Price' });
    },
  };
}

describe('Customize · Add to Combo Price', () => {
  it.each(['sales_director', 'sales'])('uses granted pricing access for the %s role', (role) => {
    state.role = role;
    const view = mount();
    const dialog = view.open();
    expect(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' })).toHaveValue(3152.63);
    expect(within(dialog).queryByRole('spinbutton', { name: 'Selling price at 26 inches' })).not.toBeInTheDocument();
    expect(state.readCombos).toHaveBeenCalledWith({ baseModel: 'TANNAH', customerId: null });
  });

  it('keeps pricing creation hidden from an ordinary salesperson', () => {
    state.role = 'sales';
    state.canMaintain = false;
    mount();
    expect(screen.queryAllByRole('button', { name: 'Add to Combo Price' })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: 'Save as Quick Pick' }).length).toBeGreaterThan(0);
  });

  it('offers the selected 37-inch depth even when it is absent from the maintenance pool', () => {
    const dialog = mount({
      depth: '37', cells: cellsFromComboModules([['1A(LHF)'], ['2A(RHF)']], '37'),
    }).open();
    expect(within(dialog).getByRole('spinbutton', { name: 'Selling price at 37 inches' })).toHaveValue(3152.63);
  });

  it('excludes recliner upgrades and other add-ons from the reusable module price', () => {
    const cells = closedCells();
    cells[0]!.recliners = [{ seatIdx: 0, open: false }];
    const dialog = mount({
      cells, pricing: { ...PRICING, reclinerUpgradeSen: 99_000 },
      legSurchargeRm: 100, extraAmountRm: 200,
    }).open();
    expect(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' })).toHaveValue(3152.63);
  });

  it.each([
    ['empty build', { cells: [] }],
    ['open build', { cells: closedCells().slice(0, 1) }],
    ['missing model', { baseModel: '  ' }],
    ['Marketing layout', { layoutOnly: {} }],
    ['two separate sofas', { cells: [
      ...closedCells(),
      ...closedCells().map((cell) => ({ ...cell, id: cell.id + '-second', y: cell.y + 300 })),
    ] }],
  ] satisfies [string, Partial<Props>][])('does not create a combo for %s', (_label, props) => {
    mount(props);
    expect(screen.queryAllByRole('button', { name: 'Add to Combo Price' })).toHaveLength(0);
  });

  it.each([
    ['selling prices are loading', { sellingDataReady: false }],
    ['model options are loading', { modelCustomizerState: 'pending' }],
    ['model options failed', { modelCustomizerState: 'error' }],
  ] satisfies [string, Partial<Props>][])('waits while %s, then seeds the loaded price', (_label, pending) => {
    const view = mount({
      ...pending,
      pricing: {
        ...PRICING,
        compartments: PRICING.compartments.map((row) => ({ ...row, priceSen: 0 })),
      },
    });
    expect(screen.queryAllByRole('button', { name: 'Add to Combo Price' })).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'Add to Combo Price' })).not.toBeInTheDocument();

    view.rerender({ sellingDataReady: true, modelCustomizerState: 'ready', pricing: PRICING });
    const dialog = view.open();
    expect(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' })).toHaveValue(3152.63);
  });

  it('saves the current modules and entered selling amount in sen, then closes', async () => {
    const dialog = mount().open();
    const price = within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' });
    expect(price).toHaveAttribute('step', '0.01');
    fireEvent.change(price, { target: { value: '2990.75' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create combo' }));
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    const payload = state.create.mock.calls[0]![0];
    expect(payload).toMatchObject({
      baseModel: 'TANNAH', modules: [['1A(LHF)'], ['2A(RHF)']], tier: 'PRICE_1',
      sellingPricesByHeight: { '24': 299075, '28': null },
    });
    expect(payload).not.toHaveProperty('pricesByHeight');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add to Combo Price' })).not.toBeInTheDocument());
  });

  it('blocks a duplicate instead of writing another effective price row', async () => {
    state.combos.data = [{
      id: 'existing', baseModel: 'TANNAH', modules: [['2A(RHF)'], ['1A(LHF)']], tier: 'PRICE_1',
      customerId: null, pricesByHeight: {}, sellingPricesByHeight: { '24': 299000 },
      label: null, effectiveFrom: '2026-10-01', deletedAt: null, notes: '',
      createdAt: '2026-10-01', updatedAt: '2026-10-01', createdBy: null,
    }];
    const dialog = mount().open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create combo' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/already exists/i));
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each(['', '-1', '2990.001'])('rejects an invalid selling amount %j', (price) => {
    const dialog = mount().open();
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' }), { target: { value: price } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create combo' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Enter a/);
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each(['loading', 'error'] as const)('blocks creation while duplicate checks are %s', (status) => {
    state.combos.data = undefined;
    state.combos.isPending = status === 'loading';
    state.combos.isLoading = status === 'loading';
    state.combos.isError = status === 'error';
    const dialog = mount().open();
    const create = within(dialog).getByRole('button', { name: 'Create combo' });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(state.create).not.toHaveBeenCalled();
    if (status === 'error') {
      fireEvent.click(within(dialog).getByRole('button', { name: /Retry/i }));
      expect(state.combos.refetch).toHaveBeenCalledOnce();
    }
  });

  it('retains the entered price when creation fails so it can be retried', async () => {
    state.create.mockRejectedValueOnce(new Error('Permission denied'));
    const dialog = mount().open();
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' }), { target: { value: '2990' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create combo' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(/Permission denied/));
    expect(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' })).toHaveValue(2990);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create combo' }));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(2));
  });
});

const cushion: SofaAccessoryOption = { modelId: 'bc06', productId: 'sku-bc06', code: 'BC06', name: 'Back cushion', role: 'back', priceSen: 25025, armWidthCm: 20 };
const pieces: PlacedAccessory[] = [
  { id: 'p1', modelId: 'bc06', cellId: 'a', slot: 0 },
  { id: 'p2', modelId: 'bc06', cellId: 'b', slot: 0 },
];
const withAccessories: Partial<Props> = {
  initialAccessories: pieces,
  modelCustomizer: { compartments: [], sellingRows: [], sizes: ['24'], legHeights: [], specials: [], fabricIds: [], accessories: [cushion], accessoriesNeeded: [], modelId: 'model', modelName: 'TANNAH', modelCode: 'TANNAH' },
};

describe('sofa accessories saved and priced with the sofa', () => {
  it('seeds and saves the whole sofa + accessory package, keeping its quantities', async () => {
    const dialog = mount(withAccessories).open();
    expect(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' })).toHaveValue(3653.13);
    expect(within(dialog).getByText(/Included sofa accessories:/)).toHaveTextContent('BC06 × 2');
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Selling price at 24 inches' }), { target: { value: '3300.25' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create combo' }));
    await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
    expect(state.create.mock.calls[0]![0]).toMatchObject({ accessories: [{ modelId: 'bc06', qty: 2 }], sellingPricesByHeight: { '24': 330025 } });
  });

  it.each(['sales_director', 'sales'])('saves the exact accessory layout for %s', async (role) => {
    state.role = role;
    const view = mount(withAccessories);
    fireEvent.click(within(view.container.querySelector('footer')!).getByRole('button', { name: 'Save as Quick Pick' }));
    const dialog = screen.getByRole('dialog', { name: 'Save as Quick Pick' });
    fireEvent.click(within(dialog).getByRole('button', { name: role === 'sales' ? 'Save to “Yours”' : 'Save to shared' }));
    const save = role === 'sales' ? state.savePersonal : state.saveShared;
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0]![0].layout).toEqual({ cells: closedCells(), accessories: pieces });
  });

  it('charges covered pieces once and leaves extra pieces at their exact selling price', () => {
    const pricing: SofaProductPricing = { ...PRICING, baseModel: 'TANNAH', fabricTier: 'PRICE_1', combos: [{
      id: 'package', baseModel: 'TANNAH', modules: [['1A(LHF)'], ['2A(RHF)']], accessories: [{ modelId: 'bc06', qty: 1 }],
      customerId: null, tier: 'PRICE_1', pricesByHeight: { '24': 300025 }, effectiveFrom: '2020-01-01',
    }] };
    mount({ ...withAccessories, pricing });
    fireEvent.click(screen.getByRole('button', { name: 'Add to cart' }));
    const lines = useCart.getState().lines;
    expect(lines).toHaveLength(3);
    expect(lines[0]!.config.total).toBe(3000.25);
    expect(lines.slice(1).map((line) => [line.qty, line.config.total])).toEqual([[1, 0], [1, 250.25]]);
    expect(lines.reduce((sum, line) => sum + line.qty * line.config.total, 0)).toBe(3250.5);
    useCart.getState().setQty(lines[0]!.key, 2);
    expect(useCart.getState().lines.reduce((sum, line) => sum + line.qty * line.config.total, 0)).toBe(6501);
    useCart.getState().remove(lines[0]!.key);
    expect(useCart.getState().lines).toHaveLength(0);
  });
});
