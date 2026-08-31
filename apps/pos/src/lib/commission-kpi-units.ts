// ----------------------------------------------------------------------------
// Turn a Sales Order's item lines into item-KPI "units" — the shape the
// commission engine reads to decide which rules fire, what bonus is earned, and
// how much (if anything) leaves the goods a percentage is paid on.
//
// PURE. No network, no React. The fetching lives in commission-kpi-queries.ts.
//
// ── WHAT A "UNIT" IS, AND WHY IT IS NOT A LINE ──────────────────────────────
// One purchased item. A POS sofa build is persisted as several per-module SO
// lines (so-sofa-split) that all carry the same fabric, and its fabric-tier
// add-on is ONE flat per-build figure spread across them. So module lines of one
// build collapse back into a single unit, keyed on `variants.buildKey`: the
// bonus and the exclusion each count ONCE per built sofa, not once per module.
// Getting this wrong pays an N-module sofa N times, which is the bug PR #693
// fixed on the server side.
//
// ── 🔴 THE UNIT TRAP ────────────────────────────────────────────────────────
// Three money sources meet here and they do NOT agree:
//
//   · SO line totals          — INTEGER CENTI (`total_sen` / `total_centi`)
//   · special-order surcharge — INTEGER CENTI (`special_order_price_sen`)
//   · the fabric-tier add-on  — WHOLE RINGGIT. `fabricTierAddon()` returns MYR,
//                               and every POS sell-time caller folds it straight
//                               into a whole-ringgit price
//                               (Configurator.tsx: `sofaFabricDelta`).
//
// KpiUnit wants centi throughout. The conversion is therefore REAL, it is ×100,
// and it is a silent 100× error on a payroll figure if it is missed or applied
// twice. It happens in exactly one place — `myrToCenti` — which exists as a
// named, tested function for that reason and must not be inlined.
// ----------------------------------------------------------------------------

import type { KpiUnit } from '@2990s/shared/hr-commission';

/** Whole ringgit → integer centi. The ONE place the fabric-tier add-on crosses
 *  from the sell-time vocabulary into the payroll one. */
export const myrToCenti = (myr: number): number => Math.round(myr * 100);

/** One SO item line, already normalised out of either backend's spelling. */
export interface CommissionLine {
  itemCode: string;
  qty: number;
  /** Line total, qty-inclusive and post-discount, in centi. */
  totalCenti: number;
  /** Special-order surcharge on this line, in centi (0 when none). Read from
   *  the line, never recomputed — it is a stored column. */
  specialSurchargeCenti: number;
  /** 'service' lines never earn commission and are never KPI units. */
  itemGroup: string | null;
  /** Groups a split sofa's module lines. Absent on every non-sofa line. */
  buildKey: string | null;
  fabricId: string | null;
  /** Special-order add-on codes carried on the line. */
  specialCodes: string[];
  /** The compartment code this module occupies, for the per-compartment
   *  fabric-tier override. Null on non-sofa lines. */
  compartmentCode: string | null;
}

/** Everything the caller must resolve from the catalogue before units can be
 *  built. Injected rather than fetched so this module stays pure and testable. */
export interface UnitContext {
  /** UPPERCASE product category ('SOFA' / 'BEDFRAME' / …), or null when the SKU
   *  could not be resolved. A category rule then simply does not fire, rather
   *  than guessing and paying a bonus nobody configured. */
  categoryOf: (itemCode: string) => string | null;
  /**
   * The per-ITEM fabric-tier add-on this unit was charged, in WHOLE RINGGIT —
   * the same figure and the same shared `fabricTierAddon` the POS used when it
   * sold the thing, so the reported add-on cannot drift from the billed one.
   *
   * Return `null` for "cannot resolve". That is NOT zero: zero means "no add-on
   * was charged", and a payroll screen must not confuse the two. An unresolved
   * add-on is reported to the caller and the unit is left un-excluded rather
   * than silently under-excluded.
   */
  fabricAddonMyr: (u: {
    itemCodes: string[];
    category: string | null;
    fabricId: string;
    compartments: string[];
  }) => number | null;
}

export interface BuiltUnits {
  units: KpiUnit[];
  /** Units whose fabric add-on could not be resolved. Surfaced, never swallowed:
   *  each one is a goods exclusion that did not happen. */
  unresolvedFabric: string[];
}

const norm = (v: unknown): string => String(v ?? '').trim();

/**
 * Build the KPI units for ONE Sales Order.
 *
 * `fabricAddonMyr` is only consulted for units that actually carry a fabric, so
 * a period with no fabric rules configured costs nothing extra.
 */
export const buildKpiUnits = (
  lines: CommissionLine[],
  ctx: UnitContext,
): BuiltUnits => {
  /* Group by build. A line with no buildKey is its own unit — using the item
     code as the key would wrongly merge two separate purchases of the same SKU
     on one order, so each gets a unique synthetic key. */
  const groups = new Map<string, CommissionLine[]>();
  lines.forEach((l, i) => {
    // A service line is not a purchased item: it is not in the goods buckets the
    // percentage runs on, so excluding it would REDUCE goods that never held it.
    if ((l.itemGroup ?? '').toLowerCase() === 'service') return;
    const key = l.buildKey ? `build:${l.buildKey}` : `line:${i}`;
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  });

  const units: KpiUnit[] = [];
  const unresolvedFabric: string[] = [];

  for (const group of groups.values()) {
    /* A build's qty is uniform across its module lines (so-sofa-split writes the
       same qty on each), so take it once. MAX rather than [0] so a hand-edited
       line cannot silently shrink the build. */
    const qty = Math.max(...group.map((l) => l.qty || 0), 0);
    const itemCodes = [...new Set(group.map((l) => norm(l.itemCode)).filter(Boolean))];
    const lineTotalCenti = group.reduce((s, l) => s + l.totalCenti, 0);
    /* The surcharge is PER ITEM, and it is the same on every module line of one
       build (it is charged on the build). Summing across modules would multiply
       it — take the max, which equals the value on any one line. */
    const specialSurchargeUnitCenti = Math.max(...group.map((l) => l.specialSurchargeCenti || 0), 0);
    const specialCodes = [...new Set(group.flatMap((l) => l.specialCodes).map(norm).filter(Boolean))];
    const fabricId = group.map((l) => l.fabricId).find((f) => !!f) ?? null;
    /* Category comes from any module's SKU — every module of one build belongs to
       the same product. First resolvable wins. */
    const category = itemCodes.map((c) => ctx.categoryOf(c)).find((v) => v != null) ?? null;

    let fabricAddonUnitCenti = 0;
    if (fabricId) {
      const compartments = group
        .map((l) => norm(l.compartmentCode))
        .filter(Boolean);
      const myr = ctx.fabricAddonMyr({ itemCodes, category, fabricId, compartments });
      if (myr === null) {
        // Reported, not guessed. Leaving it at 0 means the unit is not excluded,
        // which OVER-pays rather than under-pays — the safer direction — but the
        // caller must still be told.
        unresolvedFabric.push(itemCodes[0] ?? '(unknown item)');
      } else {
        fabricAddonUnitCenti = myrToCenti(myr);
      }
    }

    units.push({
      itemCodes,
      qty,
      category,
      fabricId,
      specialCodes,
      lineTotalCenti,
      fabricAddonUnitCenti,
      specialSurchargeUnitCenti,
    });
  }

  return { units, unresolvedFabric };
};
