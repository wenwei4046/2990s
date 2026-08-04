import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findSkuUsage, findModelUsage, SkuUsageUndetermined } from './sku-usage';

/* Minimal Supabase stub: from(table).select(...).eq(...).limit(...) resolves to
 * whatever `responses[table]` holds. Mirrors the exact chain sku-usage.ts uses. */
type Resp = { data: unknown[] | null; error: unknown };

function stub(responses: Record<string, Resp>): SupabaseClient {
  const make = (table: string) => {
    const resp = responses[table] ?? { data: [], error: null };
    const chain = {
      select: () => chain,
      eq: () => chain,
      limit: () => Promise.resolve(resp),
      then: (res: (v: Resp) => unknown) => Promise.resolve(resp).then(res),
    };
    return chain;
  };
  return { from: (table: string) => make(table) } as unknown as SupabaseClient;
}

const OK_EMPTY: Resp = { data: [], error: null };

describe('findSkuUsage', () => {
  it('returns null when the SKU appears in none of the three documents', async () => {
    const sb = stub({
      mfg_sales_order_items: OK_EMPTY,
      purchase_order_items: OK_EMPTY,
      inventory_movements: OK_EMPTY,
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).resolves.toBeNull();
  });

  it('reports the first document the SKU is used in', async () => {
    const sb = stub({
      mfg_sales_order_items: { data: [{ doc_no: 'SO-3001' }], error: null },
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).resolves.toEqual({
      where: 'a sales order',
      doc: 'SO-3001',
    });
  });

  it('still tolerates a table that does not exist yet on a fresh DB', async () => {
    // 42P01 = Postgres undefined_table. This is the ONLY error class that may
    // be skipped — it is the case the original best-effort skip was for.
    const sb = stub({
      mfg_sales_order_items: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
      purchase_order_items: OK_EMPTY,
      inventory_movements: OK_EMPTY,
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).resolves.toBeNull();
  });

  it('tolerates PostgREST schema-cache misses (PGRST205)', async () => {
    const sb = stub({
      mfg_sales_order_items: { data: null, error: { code: 'PGRST205', message: 'not found in schema cache' } },
      purchase_order_items: OK_EMPTY,
      inventory_movements: OK_EMPTY,
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).resolves.toBeNull();
  });

  /* ── the regression this module was hardened for ─────────────────────────
     Before 2026-08-04 these threw nothing and resolved to null, which the
     delete routes read as "unused" and allowed the delete through. */

  it('THROWS instead of reporting "unused" on a transient query error', async () => {
    const sb = stub({
      mfg_sales_order_items: { data: null, error: { code: '57014', message: 'statement timeout' } },
      purchase_order_items: OK_EMPTY,
      inventory_movements: OK_EMPTY,
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).rejects.toBeInstanceOf(SkuUsageUndetermined);
  });

  it('THROWS on an error carrying no code at all (network reset)', async () => {
    const sb = stub({
      mfg_sales_order_items: { data: null, error: { message: 'fetch failed' } },
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).rejects.toBeInstanceOf(SkuUsageUndetermined);
  });

  it('THROWS on an RLS denial rather than treating it as unused', async () => {
    const sb = stub({
      mfg_sales_order_items: OK_EMPTY,
      purchase_order_items: OK_EMPTY,
      inventory_movements: { data: null, error: { code: '42501', message: 'permission denied' } },
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).rejects.toBeInstanceOf(SkuUsageUndetermined);
  });

  it('names the table it could not verify', async () => {
    const sb = stub({
      mfg_sales_order_items: OK_EMPTY,
      purchase_order_items: { data: null, error: { code: '57014', message: 'timeout' } },
    });
    await expect(findSkuUsage(sb, 'SOFA-1A')).rejects.toMatchObject({
      table: 'purchase_order_items',
    });
  });

  it('returns null for an empty code without querying', async () => {
    const sb = stub({});
    await expect(findSkuUsage(sb, '')).resolves.toBeNull();
  });
});

describe('findModelUsage', () => {
  it('returns null when the model has no SKUs', async () => {
    const sb = stub({ mfg_products: OK_EMPTY });
    await expect(findModelUsage(sb, 'model-1')).resolves.toBeNull();
  });

  it('THROWS when the SKU lookup itself fails', async () => {
    // An unknown number of SKUs went unchecked — usage is undetermined, and
    // must never be reported as "safe to delete".
    const sb = stub({
      mfg_products: { data: null, error: { code: '57014', message: 'statement timeout' } },
    });
    await expect(findModelUsage(sb, 'model-1')).rejects.toBeInstanceOf(SkuUsageUndetermined);
  });

  it('propagates SkuUsageUndetermined raised while checking a child SKU', async () => {
    const sb = stub({
      mfg_products: { data: [{ code: 'SOFA-1A' }], error: null },
      mfg_sales_order_items: { data: null, error: { code: '57014', message: 'timeout' } },
    });
    await expect(findModelUsage(sb, 'model-1')).rejects.toBeInstanceOf(SkuUsageUndetermined);
  });

  it('reports which SKU under the model is in use', async () => {
    const sb = stub({
      mfg_products: { data: [{ code: 'SOFA-1A' }], error: null },
      mfg_sales_order_items: { data: [{ doc_no: 'SO-3001' }], error: null },
    });
    await expect(findModelUsage(sb, 'model-1')).resolves.toEqual({
      code: 'SOFA-1A',
      where: 'a sales order',
      doc: 'SO-3001',
    });
  });
});
