// ----------------------------------------------------------------------------
// Tests for the supplier-scoped PO pricing resolver.
//
// Commander 2026-05-27: supplier maintenance overrides master selling-price
// maintenance for PO line surcharges. Covers:
//   1. Supplier has its own config row → uses supplier surcharges
//   2. Supplier has no config row     → falls back to master
//   3. Neither exists                  → returns null cleanly
//   4. Supplier id missing/null        → falls straight back to master
// ----------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { resolveMaintenanceConfigForSupplier } from './po-pricing';
import type { MaintenanceConfig } from '@2990s/shared/mfg-pricing';

/** Minimal MaintenanceConfig fixture — only the fields that PO pricing reads. */
const mkCfg = (divanPriceSen: number): MaintenanceConfig => ({
  divanHeights:   [{ value: '8"', priceSen: divanPriceSen }],
  legHeights:     [],
  totalHeights:   [],
  gaps:           [],
  specials:       [],
  sofaLegHeights: [],
  sofaSpecials:   [],
  sofaSizes:      [],
} as unknown as MaintenanceConfig);

/** Builds a fluent Supabase mock that yields the rows the resolver queries. */
function mockSb(rowsByScope: Record<string, { config: MaintenanceConfig } | null>) {
  return {
    from(_table: string) {
      let scopeFilter: string | null = null;
      const builder = {
        select() { return builder; },
        eq(col: string, val: string) {
          if (col === 'scope') scopeFilter = val;
          return builder;
        },
        lte() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        async maybeSingle() {
          const row = scopeFilter !== null ? rowsByScope[scopeFilter] ?? null : null;
          return { data: row, error: null };
        },
      };
      return builder;
    },
  };
}

describe('resolveMaintenanceConfigForSupplier', () => {
  it('uses the supplier config when one exists', async () => {
    const sb = mockSb({
      'supplier:sup-1': { config: mkCfg(999) },
      master:           { config: mkCfg(500) },
    });
    const out = await resolveMaintenanceConfigForSupplier(sb, 'sup-1');
    expect(out.scope).toBe('supplier');
    expect(out.config?.divanHeights?.[0]?.priceSen).toBe(999);
  });

  it('falls back to master when the supplier has no config', async () => {
    const sb = mockSb({
      'supplier:sup-2': null,
      master:           { config: mkCfg(500) },
    });
    const out = await resolveMaintenanceConfigForSupplier(sb, 'sup-2');
    expect(out.scope).toBe('master');
    expect(out.config?.divanHeights?.[0]?.priceSen).toBe(500);
  });

  it('returns null cleanly when neither scope has a row', async () => {
    const sb = mockSb({});
    const out = await resolveMaintenanceConfigForSupplier(sb, 'sup-3');
    expect(out.scope).toBeNull();
    expect(out.config).toBeNull();
  });

  it('skips the supplier lookup when supplierId is null', async () => {
    const sb = mockSb({
      master: { config: mkCfg(123) },
    });
    const out = await resolveMaintenanceConfigForSupplier(sb, null);
    expect(out.scope).toBe('master');
    expect(out.config?.divanHeights?.[0]?.priceSen).toBe(123);
  });

  it('skips the supplier lookup when supplierId is an empty string', async () => {
    const sb = mockSb({
      master: { config: mkCfg(7) },
    });
    const out = await resolveMaintenanceConfigForSupplier(sb, '');
    expect(out.scope).toBe('master');
    expect(out.config?.divanHeights?.[0]?.priceSen).toBe(7);
  });
});
