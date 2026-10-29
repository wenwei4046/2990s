import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ apiUrl: 'https://erp.houzscentury.com/api/scm' as string | undefined }));
vi.mock('../apiClient', () => ({
  authedFetch: vi.fn(), authedFetchRaw: vi.fn(),
  get API_URL() { return backend.apiUrl; },
  IS_HOUZS: true, HOUZS_COMPANY_ID: '2',
  houzsApiRoot: () => 'https://erp.houzscentury.com/api',
  posApiBase: () => 'https://erp.houzscentury.com/api/pos',
}));

import { resolvePhotoUrl } from '../queries';
import { resolveCompartmentImageSrc } from './product-photos';

beforeEach(() => {
  backend.apiUrl = 'https://erp.houzscentury.com/api/scm';
  // Production retains this legacy env var after switching the active API.
  vi.stubEnv('VITE_API_URL', 'https://api.2990shome.com');
});
afterEach(() => vi.unstubAllEnvs());

describe('Products photo URLs', () => {
  it('loads relative model photos from the active Houzs API despite the legacy env URL', () => {
    expect(resolvePhotoUrl('/product-models/model-lobbi/photo/key.png'))
      .toBe('https://erp.houzscentury.com/api/scm/product-models/model-lobbi/photo/key.png');
    expect(resolvePhotoUrl('product-models/model-boontal/photo/key.png'))
      .toBe('https://erp.houzscentury.com/api/scm/product-models/model-boontal/photo/key.png');
  });

  it('uses the same active API for uploaded compartments and encodes both path parameters', () => {
    const key = 'sofa-compartments/Console%2FWC/photo 1.png';
    expect(resolveCompartmentImageSrc('Console/WC', key))
      .toBe('https://erp.houzscentury.com/api/scm/maintenance-config/sofa-compartments/Console%2FWC/photo/sofa-compartments%2FConsole%252FWC%2Fphoto%201.png');
  });

  it('continues to use the legacy API when it is the selected backend', () => {
    backend.apiUrl = 'https://api.2990shome.com';
    expect(resolvePhotoUrl('/product-models/model-1/photo/key.png'))
      .toBe('https://api.2990shome.com/product-models/model-1/photo/key.png');
    expect(resolveCompartmentImageSrc('1NA', 'sofa-compartments/1NA/key.png'))
      .toBe('https://api.2990shome.com/maintenance-config/sofa-compartments/1NA/photo/sofa-compartments%2F1NA%2Fkey.png');
  });

  it('preserves external photos and keeps bundled art on the POS origin', () => {
    const external = 'https://images.example.test/sofa.png?version=2';
    expect(resolvePhotoUrl(external)).toBe(external);
    expect(resolveCompartmentImageSrc('1NA', external)).toBe(external);
    expect(resolveCompartmentImageSrc('1NA', 'sofa-modules/1NA.svg')).toBe('/sofa-modules/1NA.svg');
  });

  it('keeps missing photos empty and relative paths usable in local dev without an API URL', () => {
    expect(resolvePhotoUrl(null)).toBeNull();
    expect(resolveCompartmentImageSrc('1NA', undefined)).toBeNull();
    backend.apiUrl = undefined;
    expect(resolvePhotoUrl('/product-models/model-1/photo/key.png')).toBe('/product-models/model-1/photo/key.png');
    expect(resolveCompartmentImageSrc('1NA', 'sofa-compartments/1NA/key.png'))
      .toBe('/maintenance-config/sofa-compartments/1NA/photo/sofa-compartments%2F1NA%2Fkey.png');
  });
});
