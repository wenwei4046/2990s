import { describe, it, expect, vi } from 'vitest';
import { findServiceLineCodes, serviceLinesNotReturnableResponse } from './service-line-guard';

/* Minimal supabase stub for the catalog-category lookup:
   from('mfg_products').select('code, category').in('code', [...]) */
const mockSb = (rows: Array<{ code: string; category: string | null }>) => {
  const inFn = vi.fn(async () => ({ data: rows }));
  return {
    sb: { from: vi.fn(() => ({ select: vi.fn(() => ({ in: inFn })) })) },
    inFn,
  };
};

describe('findServiceLineCodes', () => {
  it('flags lines by item_group without touching the catalog', async () => {
    const { sb, inFn } = mockSb([]);
    const out = await findServiceLineCodes(sb, [
      { itemCode: 'CUSTOM-FEE', itemGroup: 'service' },
    ]);
    expect(out).toEqual(['CUSTOM-FEE']);
    // All lines classified by payload signals → no lookup left to do.
    expect(inFn).not.toHaveBeenCalled();
  });

  it('flags lines by SVC- code prefix even with a goods item_group', async () => {
    const { sb } = mockSb([]);
    const out = await findServiceLineCodes(sb, [
      { itemCode: 'SVC-DISPOSE-MATTRESS', itemGroup: 'mattress' },
    ]);
    expect(out).toEqual(['SVC-DISPOSE-MATTRESS']);
  });

  it('catches a crafted payload via the catalog category lookup', async () => {
    const { sb, inFn } = mockSb([{ code: 'INSTALL-FEE', category: 'SERVICE' }]);
    const out = await findServiceLineCodes(sb, [
      { itemCode: 'INSTALL-FEE', itemGroup: 'others' }, // lies about group, no SVC- prefix
      { itemCode: 'ANNSA-1A(LHF)', itemGroup: 'sofa' },
    ]);
    expect(out).toEqual(['INSTALL-FEE']);
    expect(inFn).toHaveBeenCalledTimes(1);
  });

  it('returns empty for pure goods lines', async () => {
    const { sb } = mockSb([
      { code: 'ANNSA-1A(LHF)', category: 'SOFA' },
      { code: 'KHL35', category: 'BEDFRAME' },
    ]);
    const out = await findServiceLineCodes(sb, [
      { itemCode: 'ANNSA-1A(LHF)', itemGroup: 'sofa' },
      { itemCode: 'KHL35', itemGroup: 'bedframe' },
    ]);
    expect(out).toEqual([]);
  });

  it('dedupes repeated offenders and labels blank codes', async () => {
    const { sb } = mockSb([]);
    const out = await findServiceLineCodes(sb, [
      { itemCode: 'SVC-LIFT-CARRY', itemGroup: 'service' },
      { itemCode: 'SVC-LIFT-CARRY', itemGroup: 'service' },
      { itemCode: '', itemGroup: 'service' },
    ]);
    expect(out.sort()).toEqual(['(blank)', 'SVC-LIFT-CARRY']);
  });
});

describe('serviceLinesNotReturnableResponse', () => {
  it('carries the canonical error code and the offending SKUs', () => {
    const body = serviceLinesNotReturnableResponse(['SVC-DELIVERY']);
    expect(body.error).toBe('service_lines_not_returnable');
    expect(body.serviceCodes).toEqual(['SVC-DELIVERY']);
    expect(body.message).toContain('SVC-DELIVERY');
  });
});
