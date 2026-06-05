// ----------------------------------------------------------------------------
// service-lines — pure builders that turn server-computed charges into
// SERVICE SKU line specs (P2 of the SO all-charges-as-SKU-lines spec,
// docs/specs/2026-06-04-so-sku-lines-and-sync-spec.md §4.1 + §4.2).
//
// The MONEY is computed elsewhere (computeSoDeliveryFee for delivery,
// the addons table for dispose/lift) — these builders only decide how the
// amounts decompose into lines (which SKU, qty, unit price, description).
// Pure + shared so the API and tests run the same decomposition.
//
// All amounts here are SEN (the SO ledger unit). The addons table is
// whole-MYR (POS retail convention) — computeAddonServiceLines does the
// ×100 at this boundary.
// ----------------------------------------------------------------------------

import type { SoDeliveryFeeResult } from './pricing';
import {
  SVC_DELIVERY,
  SVC_DELIVERY_CROSS,
  SVC_DELIVERY_ADD,
  SVC_DISPOSE_MATTRESS,
  SVC_DISPOSE_BEDFRAME,
  SVC_LIFT_CARRY,
} from './service-sku';

/** One SERVICE line to append to a Sales Order. */
export interface ServiceLineSpec {
  itemCode:     string;
  description:  string;
  qty:          number;
  /** SEN per unit. */
  unitPriceSen: number;
  /** qty × unitPriceSen — convenience for callers summing the batch. */
  totalSen:     number;
}

/** POS handoff addon selection (mirrors the legacy submitOrder shape —
 *  Handover.tsx form.addons, filtered to selected entries). */
export interface AddonSelectionInput {
  id:           string;
  qty?:         number;
  floorsCount?: number;
  itemsCount?:  number;
}

/** The addons-table row fields the builder needs (whole-MYR prices). */
export interface AddonRowInput {
  id:            string;
  kind:          'qty' | 'floors_items' | 'flat' | string;
  /** Whole MYR. */
  price:         number;
  /** Whole MYR per floor·item (lift). */
  perFloorItem?: number | null;
  label?:        string | null;
  enabled?:      boolean | null;
}

/** POS addon id → SERVICE SKU code. Only these three handover addons become
 *  SO lines today; an unmapped id is skipped (defensive — POS only offers
 *  enabled handover addons). */
export const ADDON_ID_TO_SERVICE_SKU: Record<string, string> = {
  'dispose-mattress': SVC_DISPOSE_MATTRESS,
  'dispose-bedframe': SVC_DISPOSE_BEDFRAME,
  'lift':             SVC_LIFT_CARRY,
};

/** Lift pricing rule (matches the shared addonPrice / POS computeAddonTotal):
 *  the first 2 floors are free — chargeable units = max(0, floors − 2) × items. */
export const liftChargeableUnits = (floorsCount: number, itemsCount: number): number =>
  Math.max(0, Math.floor(floorsCount) - 2) * Math.max(0, Math.floor(itemsCount));

/**
 * Decompose a server-computed delivery fee into SERVICE lines (§4.1).
 *   · base       → SVC-DELIVERY, or SVC-DELIVERY-CROSS on a cross-order
 *                  follow-up (the base IS the reduced cross rate then; the
 *                  description carries the source SO for the audit trail)
 *   · crossCategory (same-order multi-category surcharge) → SVC-DELIVERY-CROSS
 *   · additional (operator free-form)                     → SVC-DELIVERY-ADD
 * Zero components produce no line; Σ lines === fee.total always.
 */
export function buildDeliveryFeeServiceLines(
  fee: SoDeliveryFeeResult,
  crossCategorySourceDocNo?: string | null,
): ServiceLineSpec[] {
  const lines: ServiceLineSpec[] = [];
  const push = (itemCode: string, description: string, amountSen: number) => {
    if (amountSen <= 0) return;
    lines.push({ itemCode, description, qty: 1, unitPriceSen: amountSen, totalSen: amountSen });
  };
  if (fee.isFollowup) {
    const src = (crossCategorySourceDocNo ?? '').trim();
    push(
      SVC_DELIVERY_CROSS,
      src ? `Cross-category delivery (follow-up of ${src})` : 'Cross-category delivery',
      fee.base,
    );
  } else {
    push(SVC_DELIVERY, fee.isSpecial ? 'Delivery fee (special model)' : 'Delivery fee', fee.base);
  }
  push(SVC_DELIVERY_CROSS, 'Cross-category delivery', fee.crossCategory);
  push(SVC_DELIVERY_ADD, 'Additional delivery fee', fee.additional);
  return lines;
}

/**
 * Re-price POS handover addons server-side and decompose into SERVICE lines
 * (§4.2 + D6). The client's amounts are never trusted — prices come from the
 * addons table rows the caller just loaded.
 *   · qty kind (dispose-*)  → qty × price
 *   · floors_items (lift)   → qty = chargeable units (first 2 floors free),
 *                             unit = per_floor_item; description spells out
 *                             "X floors × Y items" so the math is auditable
 *                             on the printed SO (D6).
 * Disabled / unknown / zero-amount selections are skipped silently.
 */
export function computeAddonServiceLines(
  selections: AddonSelectionInput[],
  addonRows: AddonRowInput[],
): ServiceLineSpec[] {
  const rowById = new Map(addonRows.map((r) => [r.id, r]));
  const lines: ServiceLineSpec[] = [];
  for (const sel of selections) {
    const row = rowById.get(sel.id);
    const itemCode = ADDON_ID_TO_SERVICE_SKU[sel.id];
    if (!row || !itemCode) continue;          // unknown to catalog or unmapped
    if (row.enabled === false) continue;      // operator disabled it since
    const label = (row.label ?? '').trim() || sel.id;
    if (row.kind === 'floors_items') {
      const floors = Math.max(0, Math.floor(sel.floorsCount ?? 0));
      const items  = Math.max(0, Math.floor(sel.itemsCount ?? 0));
      const units  = liftChargeableUnits(floors, items);
      const unitSen = Math.round(Number(row.perFloorItem ?? 0) * 100);
      if (units <= 0 || unitSen <= 0) continue;
      lines.push({
        itemCode,
        description: `${label} — ${floors} floors × ${items} items (first 2 floors free)`,
        qty: units,
        unitPriceSen: unitSen,
        totalSen: units * unitSen,
      });
    } else {
      // 'qty' (and a defensive 'flat' fallback: qty=1).
      const qty = row.kind === 'qty' ? Math.max(1, Math.floor(sel.qty ?? 1)) : 1;
      const unitSen = Math.round(Number(row.price ?? 0) * 100);
      if (unitSen <= 0) continue;
      lines.push({
        itemCode,
        description: label,
        qty,
        unitPriceSen: unitSen,
        totalSen: qty * unitSen,
      });
    }
  }
  return lines;
}
