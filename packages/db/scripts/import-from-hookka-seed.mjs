#!/usr/bin/env node
/**
 * import-from-hookka-seed.mjs
 *
 * One-shot converter: reads HOOKKA's scripts/seed.sql (SQLite/camelCase) and
 * emits Postgres INSERTs against the 2990s `mfg_*` / `fabrics` /
 * `fabric_trackings` / `product_dept_configs` schema.
 *
 * Conversions applied:
 *   - `INSERT INTO products` → `INSERT INTO mfg_products`
 *   - camelCase column lists → snake_case
 *   - fabricUsage  (REAL meters)        → fabric_usage_centi  (× 100, INTEGER)
 *   - unitM3       (REAL m³)            → unit_m3_milli       (× 1000, INTEGER)
 *   - fabric_trackings REAL columns     → _centi (× 100, INTEGER)
 *   - SQLite '[]' string → Postgres '[]'::jsonb (handled by literal in INSERT)
 *
 * Usage:
 *   node packages/db/scripts/import-from-hookka-seed.mjs \
 *     <path-to-hookka-seed.sql> > packages/db/seeds/hookka-products-import.sql
 *
 * Idempotent: each row uses `ON CONFLICT (id) DO UPDATE` so re-running is safe.
 */

import { readFileSync } from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node import-from-hookka-seed.mjs <hookka-seed.sql>');
  process.exit(1);
}

const src = readFileSync(inputPath, 'utf8');

// ── Per-table specs ────────────────────────────────────────────────────
// Each entry: matcher line prefix, target table, column rename map,
// per-column transform fn (raw SQL value-literal → new value-literal),
// and the conflict resolution clause.
const TABLES = {
  products: {
    target: 'mfg_products',
    columnMap: {
      id: 'id',
      code: 'code',
      name: 'name',
      category: 'category',
      description: 'description',
      baseModel: 'base_model',
      sizeCode: 'size_code',
      sizeLabel: 'size_label',
      fabricUsage: 'fabric_usage_centi',   // × 100
      unitM3: 'unit_m3_milli',             // × 1000
      status: 'status',
      costPriceSen: 'cost_price_sen',
      basePriceSen: 'base_price_sen',
      price1Sen: 'price1_sen',
      productionTimeMinutes: 'production_time_minutes',
      subAssemblies: 'sub_assemblies',
      skuCode: 'sku_code',
      fabricColor: 'fabric_color',
      pieces: 'pieces',
      seatHeightPrices: 'seat_height_prices',
    },
    scale: {
      fabricUsage: 100,
      unitM3: 1000,
    },
    jsonbCols: new Set(['subAssemblies', 'pieces', 'seatHeightPrices']),
    castCols: { category: 'mfg_product_category', status: 'mfg_product_status' },
    conflict: `ON CONFLICT (id) DO UPDATE SET
      code=EXCLUDED.code, name=EXCLUDED.name, category=EXCLUDED.category,
      description=EXCLUDED.description, base_model=EXCLUDED.base_model,
      size_code=EXCLUDED.size_code, size_label=EXCLUDED.size_label,
      fabric_usage_centi=EXCLUDED.fabric_usage_centi, unit_m3_milli=EXCLUDED.unit_m3_milli,
      status=EXCLUDED.status, cost_price_sen=EXCLUDED.cost_price_sen,
      base_price_sen=EXCLUDED.base_price_sen, price1_sen=EXCLUDED.price1_sen,
      production_time_minutes=EXCLUDED.production_time_minutes,
      sub_assemblies=EXCLUDED.sub_assemblies, sku_code=EXCLUDED.sku_code,
      fabric_color=EXCLUDED.fabric_color, pieces=EXCLUDED.pieces,
      seat_height_prices=EXCLUDED.seat_height_prices, updated_at=now()`,
  },

  product_dept_configs: {
    target: 'product_dept_configs',
    columnMap: {
      productCode: 'product_code',
      unitM3: 'unit_m3_milli',
      fabricUsage: 'fabric_usage_centi',
      price2Sen: 'price2_sen',
      fabCutCategory: 'fab_cut_category', fabCutMinutes: 'fab_cut_minutes',
      fabSewCategory: 'fab_sew_category', fabSewMinutes: 'fab_sew_minutes',
      woodCutCategory: 'wood_cut_category', woodCutMinutes: 'wood_cut_minutes',
      foamCategory: 'foam_category', foamMinutes: 'foam_minutes',
      framingCategory: 'framing_category', framingMinutes: 'framing_minutes',
      upholsteryCategory: 'upholstery_category', upholsteryMinutes: 'upholstery_minutes',
      packingCategory: 'packing_category', packingMinutes: 'packing_minutes',
      subAssemblies: 'sub_assemblies',
      heightsSubAssemblies: 'heights_sub_assemblies',
    },
    scale: { unitM3: 1000, fabricUsage: 100 },
    jsonbCols: new Set(['subAssemblies', 'heightsSubAssemblies']),
    castCols: {},
    conflict: 'ON CONFLICT (product_code) DO NOTHING',
  },

  fabrics: {
    target: 'fabrics',
    columnMap: {
      id: 'id',
      code: 'code',
      name: 'name',
      category: 'category',
      priceSen: 'price_sen',
      sohMeters: 'soh_meters_centi',         // × 100
      reorderLevel: 'reorder_level_centi',    // × 100
    },
    scale: { sohMeters: 100, reorderLevel: 100 },
    jsonbCols: new Set(),
    castCols: {},
    conflict: 'ON CONFLICT (id) DO NOTHING',
  },

  fabric_trackings: {
    target: 'fabric_trackings',
    columnMap: {
      id: 'id',
      fabricCode: 'fabric_code',
      fabricDescription: 'fabric_description',
      fabricCategory: 'fabric_category',
      priceTier: 'price_tier',
      price: 'price_centi',
      soh: 'soh_centi',
      poOutstanding: 'po_outstanding_centi',
      lastMonthUsage: 'last_month_usage_centi',
      oneWeekUsage: 'one_week_usage_centi',
      twoWeeksUsage: 'two_weeks_usage_centi',
      oneMonthUsage: 'one_month_usage_centi',
      shortage: 'shortage_centi',
      reorderPoint: 'reorder_point_centi',
      supplier: 'supplier',
      leadTimeDays: 'lead_time_days',
    },
    scale: {
      price: 100, soh: 100, poOutstanding: 100,
      lastMonthUsage: 100, oneWeekUsage: 100, twoWeeksUsage: 100,
      oneMonthUsage: 100, shortage: 100, reorderPoint: 100,
    },
    jsonbCols: new Set(),
    castCols: { fabricCategory: 'fabric_category', priceTier: 'fabric_price_tier' },
    conflict: 'ON CONFLICT (id) DO NOTHING',
  },
};

// ── Parser ─────────────────────────────────────────────────────────────
// HOOKKA's INSERTs are one per line:
//   INSERT INTO <table> (col, col, ...) VALUES (val, val, ...);
function parseInsert(line) {
  const m = line.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.+)\);?\s*$/);
  if (!m) return null;
  const [, table, colsRaw, valsRaw] = m;
  const cols = colsRaw.split(',').map(s => s.trim());
  const vals = splitValues(valsRaw);
  return { table, cols, vals };
}

// Split VALUES (...) respecting quoted strings (handles `'`, `''`, and JSON {} [])
function splitValues(s) {
  const out = [];
  let cur = '';
  let inStr = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      cur += ch;
      if (ch === "'" && s[i + 1] === "'") { cur += s[++i]; continue; }
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function scaleValue(val, factor) {
  if (val === 'NULL') return 'NULL';
  const n = Number(val);
  if (!Number.isFinite(n)) return val;
  return String(Math.round(n * factor));
}

function castCol(val, target) {
  if (val === 'NULL') return 'NULL';
  return `${val}::${target}`;
}

function jsonbCol(val) {
  if (val === 'NULL') return 'NULL';
  // already a SQL string literal — append ::jsonb
  return `${val}::jsonb`;
}

// ── Main ───────────────────────────────────────────────────────────────
const lines = src.split('\n');
const out = [];
out.push('-- ====================================================================');
out.push('-- hookka-products-import.sql');
out.push('-- ');
out.push('-- Auto-generated from HOOKKA scripts/seed.sql.');
out.push('-- Regenerate with: node packages/db/scripts/import-from-hookka-seed.mjs \\');
out.push('--   ../../../hookka-erp-readonly/scripts/seed.sql > seeds/hookka-products-import.sql');
out.push('-- ');
out.push('-- Targets: mfg_products, product_dept_configs, fabrics, fabric_trackings');
out.push('-- ====================================================================');
out.push('');
out.push('BEGIN;');
out.push('');

const counts = {};

for (const line of lines) {
  if (!line.startsWith('INSERT INTO ')) continue;
  const parsed = parseInsert(line);
  if (!parsed) continue;
  const spec = TABLES[parsed.table];
  if (!spec) continue;

  // map columns + transform values
  const newCols = parsed.cols.map(c => spec.columnMap[c] ?? c);
  const newVals = parsed.cols.map((c, i) => {
    let v = parsed.vals[i];
    if (spec.scale[c] != null) v = scaleValue(v, spec.scale[c]);
    if (spec.jsonbCols.has(c)) v = jsonbCol(v);
    if (spec.castCols[c]) v = castCol(v, spec.castCols[c]);
    return v;
  });

  out.push(
    `INSERT INTO ${spec.target} (${newCols.join(', ')}) ` +
    `VALUES (${newVals.join(', ')}) ${spec.conflict};`,
  );
  counts[parsed.table] = (counts[parsed.table] || 0) + 1;
}

out.push('');
out.push('COMMIT;');
out.push('');
out.push('-- ── Summary ─────────────────────────────────────────────────────────');
for (const [tbl, n] of Object.entries(counts)) {
  out.push(`-- ${tbl} → ${TABLES[tbl].target}: ${n} rows`);
}
out.push(`-- TOTAL: ${Object.values(counts).reduce((a, b) => a + b, 0)} INSERT statements`);

process.stdout.write(out.join('\n') + '\n');

// Log summary to stderr for visibility when piped
console.error('— Import summary —');
for (const [tbl, n] of Object.entries(counts)) {
  console.error(`  ${tbl.padEnd(24)} → ${TABLES[tbl].target.padEnd(24)} ${n} rows`);
}
