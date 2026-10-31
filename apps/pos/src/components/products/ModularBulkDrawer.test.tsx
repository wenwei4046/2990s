import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AllowedOptions, ProductModelRow } from '../../lib/products/product-models-queries';
import type { MfgProductRow } from '../../lib/products/mfg-products-queries';

const api = vi.hoisted(() => ({ authedFetch: vi.fn() }));
vi.mock('../../lib/apiClient', () => ({
  authedFetch: api.authedFetch,
  authedFetchRaw: vi.fn(),
  API_URL: '/api',
  IS_HOUZS: true,
  HOUZS_COMPANY_ID: '2',
  houzsApiRoot: () => '/api/scm',
  posApiBase: () => '/api/scm',
}));

import { ModularBulkDrawer, ModularCategoryMenu } from './ModularBulkDrawer';

const CFG = {
  sofaLegHeights: [{ value: '6', priceSen: 0 }],
  legHeights: [],
  gaps: [],
  divanHeights: [],
  specials: [],
  sofaSpecials: [],
  totalHeights: [],
  sofaSizes: ['24', '28'],
  sofaCompartments: ['CNR', '1NA'],
  bedframeSizes: [],
  mattressSizes: [],
};

const row = (id: string, name: string, category: string, allowed: AllowedOptions, active = true): ProductModelRow => ({
  id, name, model_code: name, category, allowed_options: allowed, active,
  branding: null, description: null, photo_url: null, created_at: '', updated_at: '',
});

type Sku = { id: string; code: string; pos_active: boolean };
/** The API's own copy of each Model — what GET /product-models/:id answers. */
let server: Record<string, { model: ProductModelRow; skus: Sku[] }> = {};
const patches: Array<{ path: string; body: Record<string, unknown> }> = [];
/** The API's copy is its own: a save must never reach the rows the list shows. */
const serve = (models: typeof server): typeof server => structuredClone(models);

function route(path: string, init?: RequestInit): unknown {
  const method = init?.method ?? 'GET';
  if (path.startsWith('/maintenance-config/resolved')) {
    return { data: CFG, effectiveFrom: null, hasPendingPriceChange: false, pendingEffectiveFrom: null };
  }
  if (path === '/special-addons') {
    return { addons: [{ id: 'a1', code: 'LATEX', label: 'Latex', soDescription: '', categories: ['SOFA'], sellingPriceSen: 0, costPriceSen: 0, optionGroups: [], active: true, sortOrder: 0 }] };
  }
  if (path === '/product-models?category=FABRIC_ACCESSORY') return { models: [] };
  if (path === '/fabric-library') return { fabrics: [] };
  if (path === '/fabric-colours') return { colours: [] };
  if (path === '/fabric-tracking/lite') return { fabrics: [] };
  const model = /^\/product-models\/([^/?]+)$/.exec(path);
  if (model && method === 'GET') return server[model[1]!];
  if (method === 'PATCH') {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    patches.push({ path, body });
    if (model && body.allowedOptions) server[model[1]!]!.model.allowed_options = body.allowedOptions as AllowedOptions;
    return model ? { model: server[model[1]!]!.model, autoCreatedSkus: [] } : { ok: true, changed: 1 };
  }
  throw new Error(`unexpected ${method} ${path}`);
}

let client: QueryClient;
const renderDrawer = (
  category: string,
  models: ProductModelRow[],
  skus: Record<string, Sku[]> = {},
  onClose = vi.fn(),
) => {
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const byModel = new Map(Object.entries(skus).map(([id, list]) => [id, list as unknown as MfgProductRow[]]));
  return render(<ModularBulkDrawer category={category} models={models} skusByModelId={byModel} onClose={onClose} />, { wrapper: wrap });
};
const chip = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  server = {};
  patches.length = 0;
  api.authedFetch.mockReset();
  api.authedFetch.mockImplementation(async (path: string, init?: RequestInit) => route(path, init));
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe('⋯ on a category', () => {
  it('opens Edit several models', () => {
    const onEditSeveral = vi.fn();
    render(<ModularCategoryMenu label="Sofa" onEditSeveral={onEditSeveral} />);
    fireEvent.click(screen.getByRole('button', { name: 'More for Sofa' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit several models/ }));
    expect(onEditSeveral).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Edit several models', () => {
  const alpha = row('m1', 'ALPHA', 'SOFA', { leg_heights: ['6'], specials: ['LATEX'], compartments: ['CNR'] });
  const beta = row('m2', 'BETA', 'SOFA', { leg_heights: ['6'] });

  it('turns an option on for every picked Model, writing only the ones it changes', async () => {
    server = serve({ m1: { model: alpha, skus: [] }, m2: { model: beta, skus: [] } });
    renderDrawer('SOFA', [alpha, beta]);

    const latex = await chip('LATEX');
    expect(latex).toHaveAttribute('aria-pressed', 'mixed');
    fireEvent.click(latex);
    expect(latex).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Saves 1 of the 2 picked models.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved 1 model.')).toBeInTheDocument();
    expect(patches).toEqual([{ path: '/product-models/m2', body: { allowedOptions: { leg_heights: ['6'], specials: ['LATEX'] } } }]);
  });

  it('only the picked Models are changed', async () => {
    server = serve({ m1: { model: alpha, skus: [] }, m2: { model: beta, skus: [] } });
    renderDrawer('SOFA', [alpha, beta]);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'BETA' }));
    expect(screen.getByText('1 of 2 picked')).toBeInTheDocument();
    // ALPHA alone already has LATEX: on for all of them, so tapping turns it off.
    fireEvent.click(await chip('LATEX'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved 1 model.')).toBeInTheDocument();
    expect(patches).toEqual([{ path: '/product-models/m1', body: { allowedOptions: { leg_heights: ['6'], specials: [], compartments: ['CNR'] } } }]);
  });

  it('re-reads each Model before writing, and leaves no old copy for its own card', async () => {
    // Saved on its own card since the list loaded: it gained a fabric.
    server = serve({ m1: { model: alpha, skus: [] }, m2: { model: { ...beta, allowed_options: { leg_heights: ['6'], fabrics: ['CG-1'] } }, skus: [] } });
    client.setQueryData(['product-models', 'm2'], { model: beta, skus: [] });
    renderDrawer('SOFA', [alpha, beta]);

    fireEvent.click(await chip('LATEX'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved 1 model.')).toBeInTheDocument();
    expect(patches[0]?.body).toEqual({ allowedOptions: { leg_heights: ['6'], fabrics: ['CG-1'], specials: ['LATEX'] } });
    // A card opened next must read the Model afresh — the copy from before
    // the save would seed its draft, and its Save would undo this one.
    expect(client.getQueryData(['product-models', 'm2'])).toBeUndefined();
  });

  it('never turns on a compartment a Model has no SKU for', async () => {
    server = serve({ m1: { model: alpha, skus: [] }, m2: { model: beta, skus: [{ id: 's1', code: 'BETA-1NA', pos_active: true }] } });
    renderDrawer('SOFA', [alpha, beta], { m2: server.m2!.skus });

    fireEvent.click(await chip('CNR'));
    expect(screen.getByText('CNR stays off on BETA: no CNR SKU yet.')).toBeInTheDocument();
    expect(screen.getByText('The picked models already read this way.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // …but one it has a SKU for is turned on.
    fireEvent.click(await chip('1NA'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved 1 model.')).toBeInTheDocument();
    expect(patches).toEqual([{ path: '/product-models/m2', body: { allowedOptions: { leg_heights: ['6'], compartments: ['1NA'] } } }]);
  });

  it('switches Show in POS on for the hidden single-SKU Models', async () => {
    const shown = row('a1', 'Pillow', 'ACCESSORY', {});
    const hidden = row('a2', 'Throw', 'ACCESSORY', {});
    server = serve({
      a1: { model: shown, skus: [{ id: 's1', code: 'PILLOW', pos_active: true }] },
      a2: { model: hidden, skus: [{ id: 's2', code: 'THROW', pos_active: false }] },
    });
    renderDrawer('ACCESSORY', [shown, hidden], { a1: server.a1!.skus, a2: server.a2!.skus });

    const show = await screen.findByRole('button', { name: 'Show in POS' });
    expect(show).toHaveAttribute('aria-pressed', 'mixed');
    expect(screen.getByText('On for 1 of 2 picked models.')).toBeInTheDocument();
    fireEvent.click(show);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved 1 model.')).toBeInTheDocument();
    expect(patches).toEqual([{ path: '/mfg-products/s2', body: { posActive: true } }]);
  });

  it('names a Model that could not be saved and keeps the edit to try again', async () => {
    server = serve({ m1: { model: alpha, skus: [] }, m2: { model: beta, skus: [] } });
    api.authedFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') throw new Error('update_failed');
      return route(path, init);
    });
    renderDrawer('SOFA', [alpha, beta]);

    fireEvent.click(await chip('LATEX'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Could not save BETA \(update_failed\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled());
  });
});
