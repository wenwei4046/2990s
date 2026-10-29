import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { MfgCatalogRow } from '../lib/queries';
import type { ProductModelRow } from '../lib/products/product-models-queries';

const mocks = vi.hoisted(() => ({
  catalog: { data: [] as MfgCatalogRow[], isLoading: false, error: null },
  models: { data: undefined as ProductModelRow[] | undefined, isLoading: false, error: null as Error | null },
  productModels: vi.fn(),
  request: vi.fn(),
  addConfigured: vi.fn(),
}));

vi.mock('../lib/queries', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/queries')>(),
  useMfgCatalog: () => mocks.catalog,
  useMfgCatalogRealtime: () => undefined,
  useCategoriesAll: () => ({ data: [
    { id: 'sofa', label: 'Sofas', tbc: false },
    { id: 'mattress', label: 'Mattresses', tbc: false },
  ] }),
}));
vi.mock('../lib/products/product-models-queries', () => ({ useProductModels: mocks.productModels }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({ data: { role: 'sales' } }), isPosSalesRole: () => true }));
vi.mock('../lib/houzs-perms', () => ({
  useHrAccess: () => ({ canRead: false }),
  useMaintainAccess: () => ({ canMaintain: false }),
  useMarketingAccess: () => ({ canUseMarketing: false }),
}));
vi.mock('../lib/marketing-api', () => ({ useMarketingState: () => ({ data: undefined }) }));
vi.mock('../lib/apiClient', () => ({
  API_URL: 'https://erp.houzscentury.com/api/scm', IS_HOUZS: true, HOUZS_COMPANY_ID: '2',
  authedFetch: mocks.request, authedFetchRaw: mocks.request,
  houzsApiRoot: () => 'https://erp.houzscentury.com/api', posApiBase: () => 'https://erp.houzscentury.com/api/pos',
}));
vi.mock('../lib/configurator-route', () => ({ preloadConfiguratorRoute: vi.fn() }));
vi.mock('../components/Topbar', () => ({ Topbar: () => null }));
vi.mock('../components/CustomerOrderFab', () => ({ CustomerOrderFab: () => null }));
vi.mock('../state/cart', () => ({
  useCart: (selector: (state: unknown) => unknown) => selector({ lines: [], addConfigured: mocks.addConfigured }),
  cartHasSofa: () => false,
  cartHasMainNonSofa: () => false,
}));

import { Catalog } from './Catalog';

const sku = (patch: Partial<MfgCatalogRow> = {}): MfgCatalogRow => ({
  id: 'sku-sofa', code: 'SOFA-01', name: 'Original sofa SKU', modelId: 'model-sofa',
  modelName: 'Original sofa', category: 'SOFA', categoryId: 'sofa', onSofa: false,
  description: null, branding: null, sizeLabel: null, basePriceSen: 299000,
  photoUrl: 'https://images.example/old-sofa.jpg', ...patch,
});
const model = (patch: Partial<ProductModelRow> = {}): ProductModelRow => ({
  id: 'model-sofa', name: 'BOONTAL', model_code: '2378', branding: '2990S SOFA',
  category: 'SOFA', photo_url: '/product-models/model-sofa/photo/current.jpg',
  description: null, allowed_options: {}, active: true, created_at: '', updated_at: '', ...patch,
});
const tree = () => <MemoryRouter><Catalog /></MemoryRouter>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.catalog.data = [sku()];
  mocks.catalog.isLoading = false;
  mocks.models.data = [model()];
  mocks.models.isLoading = false;
  mocks.models.error = null;
  mocks.productModels.mockImplementation(() => mocks.models);
});
afterEach(cleanup);

describe('Catalog Model presentation', () => {
  it('groups blank-brand SKUs by their saved Model brand and offers the same brands as working filters', () => {
    mocks.catalog.data = [sku(), sku({
      id: 'sku-mattress', code: 'MATT-01', modelId: 'model-mattress',
      category: 'MATTRESS', categoryId: 'mattress', name: 'Original mattress SKU', modelName: 'Original mattress',
    })];
    mocks.models.data = [model(), model({
      id: 'model-mattress', name: 'CLOUD', branding: 'HAPPI.S', category: 'MATTRESS',
    })];
    const { container } = render(tree());

    const headings = [...container.querySelectorAll('section > header')].map((header) => header.textContent);
    expect(headings).toEqual(expect.arrayContaining([expect.stringContaining('2990S SOFA'), expect.stringContaining('HAPPI.S')]));
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
    const filter = screen.getByRole('combobox', { name: 'Product series' });
    expect(within(filter).getAllByRole('option').map((option) => option.textContent)).toEqual(['All series', '2990S SOFA', 'HAPPI.S']);
    expect(screen.getByRole('link', { name: /BOONTAL/ })).toHaveAttribute('href', '/configure/sku-sofa');
    expect(screen.getByRole('link', { name: /CLOUD/ })).toBeInTheDocument();

    fireEvent.change(filter, { target: { value: 'HAPPI.S' } });
    expect(filter).toHaveValue('HAPPI.S');
    expect(screen.getByRole('link', { name: /CLOUD/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /BOONTAL/ })).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: '2990S SOFA' } });
    expect(screen.getByRole('link', { name: /BOONTAL/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /CLOUD/ })).not.toBeInTheDocument();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('renders the current Model photo through the active API origin instead of the cached SKU photo', () => {
    render(tree());
    const card = screen.getByRole('link', { name: /BOONTAL/ });
    const photo = card.querySelector('img');
    expect(photo).toHaveAttribute('src', 'https://erp.houzscentury.com/api/scm/product-models/model-sofa/photo/current.jpg');
    expect(card.innerHTML).not.toContain('old-sofa.jpg');
    expect(within(card).queryByText('No photo')).not.toBeInTheDocument();
    expect(mocks.productModels).toHaveBeenCalledWith({ refetchInterval: 30_000 });
  });

  it('renders selling cards while Model metadata is pending, then applies the saved presentation', () => {
    mocks.models.data = undefined;
    mocks.models.isLoading = true;
    const view = render(tree());
    expect(screen.queryByText('Loading catalog…')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Original sofa/ })).toBeInTheDocument();

    mocks.models.data = [model()];
    mocks.models.isLoading = false;
    view.rerender(tree());
    expect(screen.getByRole('link', { name: /BOONTAL/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Original sofa/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Other')).not.toBeInTheDocument();
  });

  it('keeps selling cards available when the optional Model metadata read fails', () => {
    mocks.models.data = undefined;
    mocks.models.error = new Error('Metadata unavailable');
    render(tree());
    expect(screen.getByRole('link', { name: /Original sofa/ })).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
  });

  it('shows the placeholder after the saved photo is removed instead of restoring the cached photo', () => {
    const view = render(tree());
    expect(screen.getByRole('link', { name: /BOONTAL/ }).querySelector('img')).not.toBeNull();
    mocks.models.data = [model({ photo_url: null })];
    view.rerender(tree());

    const card = screen.getByRole('link', { name: /BOONTAL/ });
    expect(card.querySelector('img')).toBeNull();
    expect(within(card).getByText('No photo')).toBeInTheDocument();
    expect(within(card).getByText('B')).toBeInTheDocument();
    expect(card.innerHTML).not.toContain('old-sofa.jpg');
  });

  it('removes a Model card when fresh metadata marks that exact Model inactive', () => {
    const view = render(tree());
    expect(screen.getByRole('link', { name: /BOONTAL/ })).toBeInTheDocument();
    mocks.models.data = [model({ active: false })];
    view.rerender(tree());
    expect(screen.queryByRole('link', { name: /BOONTAL/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No products yet/)).toBeInTheDocument();
  });
});
