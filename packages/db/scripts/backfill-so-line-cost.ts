#!/usr/bin/env tsx
/**
 * backfill-so-line-cost.ts
 *
 * One-shot backfill: recompute `unit_cost_centi` / `line_cost_centi` /
 * `line_margin_centi` for EXISTING mfg_sales_order_items rows using the fixed
 * cost engine (Commander 2026-05-28: backend maintenance `priceSen` tables ARE
 * the cost — see packages/shared/src/mfg-pricing.ts::computeMfgLineCost).
 *
 * WHY: before this PR, `computeMfgLineCost` read the never-populated
 * `costSen` / `costPriceSen` fields, so every existing SO line snapshotted
 * cost = 0 (or the mfg_products.cost_price_sen fallback, also ~0). The ~7
 * SOs created so far therefore show 0.00 in the SO list Cost columns. New SOs
 * are correct from this PR forward (the API now wires computeMfgLineCost into
 * the create/update path); this script fixes the already-persisted rows.
 *
 * WHAT IT DOES (per non-cancelled line):
 *   1. Resolve the line's product (mfg_products by item_code), fabric tier
 *      (fabric_trackings by variants.fabricCode) and the current master
 *      maintenance config (maintenance_config_history scope=master, latest).
 *   2. Run the SAME `computeMfgLineCost(input, config)` the API now uses.
 *   3. UPDATE unit_cost_centi = unit cost, line_cost_centi = unit × qty,
 *      line_margin_centi = total_centi − line_cost_centi.
 *   After the per-line pass it recomputes each touched SO header's category
 *   cost columns + total_cost/margin so the SO list rollups match.
 *
 * SAFETY:
 *   - Wrapped in a single transaction (all-or-nothing).
 *   - Pass DRY_RUN=1 to print the planned changes WITHOUT writing.
 *   - Selling price / total_centi are NOT touched (PR #265 selling-side is
 *     untouched — this is a COST-only backfill).
 *   - Run this AFTER the API deploy so the engine on the server and in this
 *     script agree.
 *
 * USAGE (from repo root):
 *   # dry run first — prints every planned change, writes nothing
 *   DB_PWD=<supabase-db-password> DRY_RUN=1 \
 *     pnpm --filter @2990s/db exec tsx scripts/backfill-so-line-cost.ts
 *
 *   # real run
 *   DB_PWD=<supabase-db-password> \
 *     pnpm --filter @2990s/db exec tsx scripts/backfill-so-line-cost.ts
 *
 * Revoke the DB password from the Supabase Dashboard right after running.
 */

import postgres from 'postgres';
import {
  computeMfgLineCost,
  type MaintenanceConfig,
  type MfgPricingProduct,
  type MfgFabricTier,
  type MfgSeatHeightPrice,
} from '@2990s/shared/mfg-pricing';

const pwd = process.env.DB_PWD;
if (!pwd) {
  console.error('Set DB_PWD env var (Supabase Postgres password).');
  process.exit(1);
}
const DRY_RUN = process.env.DRY_RUN === '1';

const PROJECT_REF = 'dolvxrchzbnqvahocwsu';
const sql = postgres({
  host: 'aws-1-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  user: `postgres.${PROJECT_REF}`,
  password: pwd,
  database: 'postgres',
  ssl: 'require',
  prepare: false,
  max: 1,
});

/* ── helpers ────────────────────────────────────────────────────────────── */

type ProductRow = {
  code: string;
  category: string;
  base_price_sen: number | null;
  price1_sen: number | null;
  cost_price_sen: number | null;
  seat_height_prices: MfgSeatHeightPrice[] | null;
};

type FabricRow = {
  fabric_code: string;
  sofa_price_tier: MfgFabricTier | null;
  bedframe_price_tier: MfgFabricTier | null;
  price_tier: MfgFabricTier | null;
};

type LineRow = {
  id: string;
  doc_no: string;
  item_code: string | null;
  item_group: string | null;
  qty: number;
  total_centi: number;
  unit_cost_centi: number;
  variants: Record<string, unknown> | null;
};

const toMfgCategory = (group: string, productCategory: string): MfgPricingProduct['category'] => {
  const c = (productCategory || group || '').toUpperCase();
  if (c.includes('BEDFRAME')) return 'BEDFRAME';
  if (c.includes('SOFA')) return 'SOFA';
  if (c.includes('MATTRESS')) return 'MATTRESS';
  if (c.includes('ACCESSOR')) return 'ACCESSORY';
  if (c.includes('SERVICE')) return 'SERVICE';
  return 'ACCESSORY';
};

const normalizeSpecials = (s: unknown): string[] => {
  if (!s) return [];
  if (Array.isArray(s)) return s.map((x) => String(x).trim()).filter(Boolean);
  return [String(s).trim()].filter(Boolean);
};

const str = (v: unknown): string | null => (v == null ? null : String(v));

async function main(): Promise<void> {
  console.log(`> backfill-so-line-cost ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);

  // Latest master maintenance config.
  const cfgRows = await sql<Array<{ config: MaintenanceConfig | null }>>`
    SELECT config FROM maintenance_config_history
    WHERE scope = 'master'
    ORDER BY effective_from DESC
    LIMIT 1
  `;
  const config = (cfgRows[0]?.config ?? null) as MaintenanceConfig | null;
  if (!config) console.warn('! No master maintenance config found — surcharges resolve to 0.');

  // Cache products + fabrics so we don't re-query per line.
  const products = new Map<string, ProductRow>();
  for (const p of await sql<ProductRow[]>`
    SELECT code, category, base_price_sen, price1_sen, cost_price_sen, seat_height_prices
    FROM mfg_products
  `) products.set(p.code, p);

  const fabrics = new Map<string, FabricRow>();
  for (const f of await sql<FabricRow[]>`
    SELECT fabric_code, sofa_price_tier, bedframe_price_tier, price_tier
    FROM fabric_trackings
  `) fabrics.set(f.fabric_code, f);

  const lines = await sql<LineRow[]>`
    SELECT id, doc_no, item_code, item_group, qty, total_centi, unit_cost_centi, variants
    FROM mfg_sales_order_items
    WHERE cancelled = false
    ORDER BY doc_no, created_at
  `;
  console.log(`> ${lines.length} non-cancelled line(s) across ${new Set(lines.map((l) => l.doc_no)).size} SO(s)`);

  const touchedDocs = new Set<string>();
  let changed = 0;

  await sql.begin(async (tx) => {
    for (const line of lines) {
      const product = line.item_code ? products.get(line.item_code) ?? null : null;
      const category = toMfgCategory(line.item_group ?? '', product?.category ?? '');
      const variants = (line.variants ?? {}) as Record<string, unknown>;
      const specials = normalizeSpecials(variants.specials ?? variants.special);

      // Resolve fabric tier per context, mirroring recomputeFromSnapshot.
      const fabricCode = str(variants.fabricCode);
      const fabric = fabricCode ? fabrics.get(fabricCode) ?? null : null;
      let tier: MfgFabricTier | null = null;
      if (fabric) {
        if (category === 'SOFA') tier = fabric.sofa_price_tier ?? fabric.price_tier ?? null;
        else if (category === 'BEDFRAME') tier = fabric.bedframe_price_tier ?? fabric.price_tier ?? null;
      }

      const pricingProduct: MfgPricingProduct = {
        category,
        basePriceSen: product?.base_price_sen ?? null,
        price1Sen: product?.price1_sen ?? null,
        seatHeightPrices: product?.seat_height_prices ?? null,
        costPriceSen: product?.cost_price_sen ?? null,
      };

      const qty = Math.max(0, Math.floor(Number(line.qty) || 0));
      const cost = computeMfgLineCost(
        {
          product: pricingProduct,
          fabric: fabric ? { tier, surchargeSen: 0 } : null,
          qty,
          divanHeight: str(variants.divanHeight),
          legHeight: str(variants.legHeight),
          totalHeight: str(variants.totalHeight),
          specials,
          seatSize: str(variants.seatHeight),
          sofaLegHeight: str(variants.sofaLegHeight),
        },
        config,
      );

      const unitCost = cost.unitPriceSen;
      const lineCost = cost.lineTotalSen;
      const lineMargin = Number(line.total_centi) - lineCost;

      if (unitCost === Number(line.unit_cost_centi)) continue; // already correct
      changed += 1;
      touchedDocs.add(line.doc_no);
      console.log(
        `  ${line.doc_no} ${line.item_code ?? '(no code)'} [${category}] ` +
        `unit_cost ${line.unit_cost_centi} → ${unitCost} (qty ${qty}, line ${lineCost})`,
      );

      if (!DRY_RUN) {
        await tx`
          UPDATE mfg_sales_order_items
          SET unit_cost_centi = ${unitCost},
              line_cost_centi = ${lineCost},
              line_margin_centi = ${lineMargin}
          WHERE id = ${line.id}
        `;
      }
    }

    // Re-roll each touched SO header's category cost columns + totals so the
    // SO list rollups stay consistent with the per-line costs.
    for (const docNo of touchedDocs) {
      if (DRY_RUN) continue;
      await tx`
        WITH agg AS (
          SELECT
            COALESCE(SUM(line_cost_centi) FILTER (
              WHERE lower(item_group) LIKE '%mattress%' OR lower(item_group) LIKE '%sofa%'), 0) AS mattress_sofa_cost,
            COALESCE(SUM(line_cost_centi) FILTER (WHERE lower(item_group) LIKE '%bedframe%'), 0) AS bedframe_cost,
            COALESCE(SUM(line_cost_centi) FILTER (WHERE lower(item_group) LIKE '%accessor%'), 0) AS accessories_cost,
            COALESCE(SUM(line_cost_centi) FILTER (
              WHERE lower(item_group) NOT LIKE '%mattress%'
                AND lower(item_group) NOT LIKE '%sofa%'
                AND lower(item_group) NOT LIKE '%bedframe%'
                AND lower(item_group) NOT LIKE '%accessor%'), 0) AS others_cost,
            COALESCE(SUM(line_cost_centi), 0) AS total_cost
          FROM mfg_sales_order_items
          WHERE doc_no = ${docNo} AND cancelled = false
        )
        UPDATE mfg_sales_orders s
        SET mattress_sofa_cost_centi = agg.mattress_sofa_cost,
            bedframe_cost_centi      = agg.bedframe_cost,
            accessories_cost_centi   = agg.accessories_cost,
            others_cost_centi        = agg.others_cost,
            total_cost_centi         = agg.total_cost,
            total_margin_centi       = s.local_total_centi - agg.total_cost,
            margin_pct_basis         = CASE WHEN s.local_total_centi > 0
              THEN round(((s.local_total_centi - agg.total_cost)::numeric / s.local_total_centi) * 10000)
              ELSE 0 END
        FROM agg
        WHERE s.doc_no = ${docNo}
      `;
    }
  });

  console.log(
    `> Done. ${changed} line(s) ${DRY_RUN ? 'would change' : 'updated'}, ` +
    `${touchedDocs.size} SO header(s) ${DRY_RUN ? 'would re-roll' : 're-rolled'}.`,
  );
}

main()
  .catch((err) => {
    console.error('✗ Backfill failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));
