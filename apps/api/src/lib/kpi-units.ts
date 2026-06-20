// ----------------------------------------------------------------------------
// kpi-units — build the item-KPI "units" for a set of Sales Orders, the single
// source both /hr/commission (per-salesperson bonus + goods exclusion + detail)
// and /pos/sales-stats (per-scope Products/Service/KPI breakdown) read from.
//
// An item-KPI-flagged purchase earns a FIXED bonus INSTEAD of % commission on
// the flagged portion (Loo 2026-06-20) — see hr-commission.ts. The "unit" is one
// purchased item: a POS sofa build is split into per-module SO lines that all
// share one fabric, and its fabric-tier Δ is a flat per-build figure spread
// across them, so module lines collapse back into ONE unit by variants.buildKey.
// The Δ a line actually charged is reproduced with the SAME shared
// fabricTierAddon the SO recompute used (incl. per-Model overrides), so this can
// never drift from what was billed (subject to the current-config caveat below).
// ----------------------------------------------------------------------------

import { type ItemKpiFlag, type KpiUnit } from '@2990s/shared/hr-commission';
import {
  fabricTierAddon,
  type FabricAddonCategory,
  type FabricTier,
  type FabricTierModelOverride,
} from '@2990s/shared/fabric-tier-addon';
import {
  loadFabricSellingTiersByIds,
  loadFabricTierAddonConfig,
  loadModelFabricTierOverrides,
  loadProductsByCodes,
} from './mfg-pricing-recompute';

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

export interface KpiUnitsResult {
  /** Active item-KPI flags (empty when none configured). */
  flags: ItemKpiFlag[];
  /** `${flag_type}:${ref}` → display label, for the commission detail rollup. */
  flagLabel: Map<string, string>;
  /** doc_no → its KPI units (split-sofa modules already collapsed per build). */
  unitsByDoc: Map<string, KpiUnit[]>;
}

const EMPTY: KpiUnitsResult = { flags: [], flagLabel: new Map(), unitsByDoc: new Map() };

type LineRow = {
  doc_no: string; item_code: string; qty: number; total_centi: number;
  special_order_price_sen: number; item_group: string | null; variants: Record<string, unknown> | null;
};
type ProductLite = { category?: string | null; model_id?: string | null };
type TierLite = { sofaTier: FabricTier | null; bedframeTier: FabricTier | null };

/**
 * Resolve every SO's item-KPI units. Returns the active flags + a per-doc unit
 * map; callers roll the units up however they need (bonus, exclusion, detail).
 * Caveat: the fabric-tier Δ is reproduced with the CURRENT fabric-tier config —
 * exact unless a tier price changes between sale and payout (stable in practice).
 */
export async function loadKpiUnitsByDoc(sb: any, docNos: string[]): Promise<KpiUnitsResult> {
  const docs = [...new Set(docNos.map((d) => (d ?? '').trim()).filter(Boolean))];
  if (docs.length === 0) return EMPTY;

  const flagsRes = await sb.from('hr_item_kpi').select('flag_type, ref, label, bonus_centi').eq('active', true);
  if (flagsRes.error) throw new Error(`kpi_flags_failed: ${flagsRes.error.message}`);
  const flags: ItemKpiFlag[] = (flagsRes.data ?? []).map((f: any) => ({ flagType: f.flag_type, ref: f.ref, bonusCenti: f.bonus_centi }));
  if (flags.length === 0) return EMPTY;
  const flagLabel = new Map<string, string>(
    (flagsRes.data ?? []).map((f: any) => [`${f.flag_type}:${f.ref}`, (f.label as string) ?? f.ref]),
  );
  const hasFabricFlag = flags.some((f) => f.flagType === 'fabric');

  // 1. gather every non-cancelled line for these docs.
  const lines: LineRow[] = [];
  for (const batch of chunk(docs, 200)) {
    const lineRes = await sb
      .from('mfg_sales_order_items')
      .select('doc_no, item_code, qty, total_centi, special_order_price_sen, item_group, variants')
      .eq('cancelled', false)
      .in('doc_no', batch);
    if (lineRes.error) throw new Error(`kpi_lines_failed: ${lineRes.error.message}`);
    for (const ln of lineRes.data ?? []) lines.push(ln as LineRow);
  }

  const norm = (v: unknown) => String(v ?? '').trim();
  const fabricIdOf = (variants: Record<string, unknown> | null): string | null => norm((variants ?? {}).fabricId) || null;
  const specialsOf = (variants: Record<string, unknown> | null): string[] => {
    const arr = (variants ?? {}).specials;
    return Array.isArray(arr) ? arr.map((s) => norm((s as { code?: unknown })?.code)).filter(Boolean) : [];
  };

  // 2. fabric-tier add-on inputs — only for lines whose fabric is actually
  //    flagged, so the work stays O(flagged lines).
  const fabricFlagRefs = new Set(flags.filter((f) => f.flagType === 'fabric').map((f) => f.ref));
  const fabricFlaggedLines = lines.filter((l) => {
    const fid = fabricIdOf(l.variants);
    return !!fid && fabricFlagRefs.has(fid);
  });
  const uniqNonEmpty = (xs: string[]) => [...new Set(xs.map((x) => (x ?? '').trim()).filter(Boolean))];
  const productByCode = new Map<string, ProductLite>();
  const tiersByFabricId = new Map<string, TierLite>();
  const addonConfig = hasFabricFlag ? await loadFabricTierAddonConfig(sb) : null;
  const modelOverrides = hasFabricFlag ? await loadModelFabricTierOverrides(sb) : new Map<string, FabricTierModelOverride>();
  if (hasFabricFlag) {
    for (const b of chunk(uniqNonEmpty(fabricFlaggedLines.map((l) => l.item_code)), 200))
      for (const [k, v] of await loadProductsByCodes(sb, b)) productByCode.set(k, v as ProductLite);
    for (const b of chunk(uniqNonEmpty(fabricFlaggedLines.map((l) => fabricIdOf(l.variants) ?? '')), 200))
      for (const [k, v] of await loadFabricSellingTiersByIds(sb, b)) tiersByFabricId.set(k, v);
  }

  // The flat fabric-tier Δ a single built item charged (centi). SOFA / BEDFRAME
  // only (the shared fn returns 0 elsewhere); for a sofa the Δ is per BUILD, so
  // every module line reports the SAME figure and the collapse keeps one.
  const fabricAddonUnitCentiOf = (l: LineRow): number => {
    if (!hasFabricFlag || !addonConfig) return 0;
    const fid = fabricIdOf(l.variants);
    if (!fid || !fabricFlagRefs.has(fid)) return 0; // unflagged fabric → its Δ stays goods
    const product = productByCode.get(norm(l.item_code));
    let cat = norm(product?.category).toUpperCase();
    if (cat !== 'SOFA' && cat !== 'BEDFRAME') {
      const g = norm(l.item_group).toLowerCase(); // product-lookup miss → fall back to the line group
      cat = g.includes('sofa') ? 'SOFA' : g.includes('bedframe') ? 'BEDFRAME' : '';
    }
    if (cat !== 'SOFA' && cat !== 'BEDFRAME') return 0;
    const category: FabricAddonCategory = cat;
    const tiers = tiersByFabricId.get(fid);
    const tier = category === 'SOFA' ? tiers?.sofaTier : tiers?.bedframeTier;
    const override = product?.model_id ? (modelOverrides.get(product.model_id) ?? null) : null;
    return fabricTierAddon(category, tier ?? null, addonConfig, override) * 100;
  };

  // 3. collapse split-sofa module lines (shared variants.buildKey, same doc)
  //    into ONE unit; every other line is its own unit.
  const unitsByDoc = new Map<string, KpiUnit[]>();
  const buildIndex = new Map<string, KpiUnit>(); // `${doc}::${buildKey}` → the build's unit
  for (const l of lines) {
    const unit: KpiUnit = {
      itemCodes: [norm(l.item_code)],
      qty: Number(l.qty) || 0,
      fabricId: fabricIdOf(l.variants),
      specialCodes: specialsOf(l.variants),
      lineTotalCenti: Number(l.total_centi) || 0,
      fabricAddonUnitCenti: fabricAddonUnitCentiOf(l),
      specialSurchargeUnitCenti: Number(l.special_order_price_sen) || 0,
    };
    const arr = unitsByDoc.get(l.doc_no) ?? [];
    if (!unitsByDoc.has(l.doc_no)) unitsByDoc.set(l.doc_no, arr);

    const buildKey = norm((l.variants ?? {}).buildKey);
    if (!buildKey) { arr.push(unit); continue; }
    const key = `${l.doc_no}::${buildKey}`;
    const existing = buildIndex.get(key);
    if (!existing) { buildIndex.set(key, unit); arr.push(unit); continue; }
    // merge a module line into its build's unit.
    existing.itemCodes.push(...unit.itemCodes);
    existing.lineTotalCenti += unit.lineTotalCenti;            // Σ → whole build's goods
    // fabric Δ + special surcharge are per-BUILD figures on the lead module line;
    // keep the lead's value (max picks it over the 0s), never sum. qty is uniform.
    existing.fabricAddonUnitCenti = Math.max(existing.fabricAddonUnitCenti, unit.fabricAddonUnitCenti);
    existing.specialSurchargeUnitCenti = Math.max(existing.specialSurchargeUnitCenti, unit.specialSurchargeUnitCenti);
  }

  return { flags, flagLabel, unitsByDoc };
}
