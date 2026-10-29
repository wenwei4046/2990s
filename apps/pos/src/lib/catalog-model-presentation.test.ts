import { describe, expect, it, vi } from 'vitest';
import { withCatalogModelPresentation } from './catalog-model-presentation';
import type { MfgCatalogRow } from './queries';

vi.mock('./apiClient', () => ({
  API_URL: 'https://erp.houzscentury.com/api/scm',
  authedFetch: vi.fn(), authedFetchRaw: vi.fn(), IS_HOUZS: true,
}));

const sku = (patch: Partial<MfgCatalogRow> = {}): MfgCatalogRow => ({
  id: 'sku-1', modelId: 'model-1', modelName: 'Old name', name: '2378-1A(LHF)',
  code: '2378-1A(LHF)', category: 'SOFA', categoryId: 'sofa', onSofa: false,
  description: null, branding: null, photoUrl: null, sizeLabel: null,
  basePriceSen: 123456, ...patch,
});
const model = (patch = {}) => ({
  id: 'model-1', name: 'BOONTAL', branding: '2990S SOFA', active: true,
  photo_url: '/product-models/model-1/photo/sofa.jpg' as string | null,
  ...patch,
});

describe('catalog model presentation', () => {
  it('uses the saved Model brand and photo for every SKU without changing selling data', () => {
    const rows = [sku(), sku({ id: 'sku-2', branding: 'OLD', basePriceSen: 234567 })];
    const snapshot = JSON.stringify(rows);
    const result = withCatalogModelPresentation(rows, [model()]);
    expect(result.map((row) => row.branding)).toEqual(['2990S SOFA', '2990S SOFA']);
    expect(result.map((row) => row.modelName)).toEqual(['BOONTAL', 'BOONTAL']);
    expect(result[0]!.photoUrl).toBe('https://erp.houzscentury.com/api/scm/product-models/model-1/photo/sofa.jpg');
    expect(result.map((row) => [row.id, row.modelId, row.basePriceSen]))
      .toEqual([['sku-1', 'model-1', 123456], ['sku-2', 'model-1', 234567]]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it('matches exact model IDs, preserving orphan and unavailable metadata fallbacks', () => {
    const rows = [sku({ modelId: 'another-model', modelName: 'BOONTAL' }), sku({ id: 'orphan', modelId: null })];
    expect(withCatalogModelPresentation(rows, [model()])).toEqual(rows);
    expect(withCatalogModelPresentation(rows, [])).toEqual(rows);
  });

  it('respects a cleared Model brand rather than restoring stale SKU branding', () => {
    expect(withCatalogModelPresentation([sku({ branding: 'LEGACY' })], [model({ branding: '  ' })])[0]!.branding).toBeNull();
    expect(withCatalogModelPresentation([sku()], [model({ branding: null })])[0]!.branding).toBeNull();
    expect(withCatalogModelPresentation([sku({ branding: 'LEGACY' })], [])[0]!.branding).toBe('LEGACY');
  });

  it('reflects photo replacement/removal and hides a newly deactivated model', () => {
    const rows = [sku({ photoUrl: 'https://old.example/old.jpg' })];
    expect(withCatalogModelPresentation(rows, [model({ photo_url: 'https://images.example/new.jpg' })])[0]!.photoUrl)
      .toBe('https://images.example/new.jpg');
    expect(withCatalogModelPresentation(rows, [model({ photo_url: null })])[0]!.photoUrl).toBeNull();
    expect(withCatalogModelPresentation(rows, [model({ active: false })])).toEqual([]);
  });
});
