import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import type { MfgCatalogRow } from '../lib/queries';

const mocks = vi.hoisted(() => ({
  catalog: { data: undefined as MfgCatalogRow[] | undefined, isLoading: true, error: null },
  marketing: vi.fn(() => ({ data: { requests: [{ status: 'pending' }] } })),
  addConfigured: vi.fn(),
}));

vi.mock('../lib/queries', () => ({
  useMfgCatalog: () => mocks.catalog,
  useMfgCatalogRealtime: () => undefined,
  useCategoriesAll: () => ({ data: [
    { id: 'sofa', label: 'Sofas', tbc: false },
    { id: 'accessory', label: 'Accessories', tbc: false },
  ] }),
}));
vi.mock('../lib/products/product-models-queries', () => ({ useProductModels: () => ({ data: [] }) }));
vi.mock('../lib/staff', () => ({ useStaff: () => ({}), isPosSalesRole: () => false }));
vi.mock('../lib/houzs-perms', () => ({
  useHrAccess: () => ({ canRead: false }),
  useMaintainAccess: () => ({ canMaintain: false }),
  useMarketingAccess: () => ({ canUseMarketing: true }),
}));
vi.mock('../lib/marketing-api', () => ({ useMarketingState: mocks.marketing }));
vi.mock('../lib/apiClient', () => ({ IS_HOUZS: true, authedFetchRaw: vi.fn() }));
vi.mock('../lib/configurator-route', () => ({ preloadConfiguratorRoute: vi.fn() }));
vi.mock('../components/Topbar', () => ({ Topbar: () => null }));
vi.mock('../components/CustomerOrderFab', () => ({ CustomerOrderFab: () => null }));
vi.mock('../state/cart', () => ({
  useCart: (selector: (state: unknown) => unknown) => selector({ lines: [], addConfigured: mocks.addConfigured }),
  cartHasSofa: () => false,
  cartHasMainNonSofa: () => false,
}));

import { Catalog } from './Catalog';

const row = (id: string, category: 'SOFA' | 'ACCESSORY' = 'SOFA'): MfgCatalogRow => ({
  id, code: `SKU-${id}`, name: id, modelId: id, modelName: id,
  category, categoryId: category === 'SOFA' ? 'sofa' : 'accessory',
  onSofa: false, description: null, branding: '2990', sizeLabel: null,
  basePriceSen: 10000, photoUrl: `/photos/${id}.jpg`,
});

const renderCatalog = () => render(<MemoryRouter><Catalog /></MemoryRouter>);

beforeEach(() => {
  mocks.catalog.data = undefined;
  mocks.catalog.isLoading = true;
  mocks.marketing.mockClear();
  mocks.addConfigured.mockClear();
});
afterEach(cleanup);

describe('Catalog loading', () => {
  it('waits for the selling catalog before fetching the marketing badge snapshot', () => {
    const view = renderCatalog();
    expect(screen.getByText('Loading catalog…')).toBeInTheDocument();
    expect(mocks.marketing).toHaveBeenLastCalledWith(false);

    mocks.catalog.data = [row('ADDA')];
    mocks.catalog.isLoading = false;
    view.rerender(<MemoryRouter><Catalog /></MemoryRouter>);

    expect(mocks.marketing).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('ADDA')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Product launching\s*1/ })).toBeInTheDocument();
  });

  it('prioritizes the first card photos and lets the browser defer the rest without changing the crop', () => {
    mocks.catalog.data = Array.from({ length: 24 }, (_, i) => row(`Sofa ${String(i).padStart(2, '0')}`));
    mocks.catalog.isLoading = false;
    const { container } = renderCatalog();
    const photos = [...container.querySelectorAll('img')];

    expect(photos).toHaveLength(24);
    expect(photos.filter((photo) => photo.getAttribute('loading') === 'eager')).toHaveLength(4);
    expect(photos.filter((photo) => photo.getAttribute('loading') === 'lazy')).toHaveLength(20);
    for (const photo of photos) {
      expect(photo).toHaveAttribute('decoding', 'async');
      expect(photo).toHaveAttribute('alt', '');
      expect(photo).toHaveStyle({ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' });
    }
  });

  it('preserves SKU search, category filtering and direct-add accessories', () => {
    mocks.catalog.data = [row('ADDA'), row('Cushion', 'ACCESSORY')];
    mocks.catalog.isLoading = false;
    renderCatalog();

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'SKU-ADDA' } });
    expect(screen.getByRole('link', { name: /ADDA/ })).toHaveAttribute('href', '/configure/ADDA');
    expect(screen.queryByText('Cushion')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Accessories\s*1/ }));
    expect(screen.queryByText('ADDA')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cushion.*Add/ }));
    expect(mocks.addConfigured).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'flat', productId: 'Cushion', total: 100,
    }), { qty: 1 });
  });
});
