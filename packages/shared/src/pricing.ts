// Pricing math. SOLE source of truth — server side recompute on POST /orders
// imports the same functions as the client (per CLAUDE.md non-negotiable +
// PORT_DESIGN.md §5.2). DO NOT duplicate this logic anywhere.

// computeSofaPrice lives in sofa-build.ts (re-exported via index). Types only:
import type { Cell, Depth, SofaPriceResult, SofaProductPricing } from './sofa-build';

/** Addon "lift access" formula. Codex P2.7 audit: POS prototype version is canonical
 *  (customer-visible at handover). Backend drawer's `floors * items * 50` was a bug. */
export const addonPrice = (
  kind: 'qty' | 'floors_items' | 'flat',
  basePrice: number,
  perFloorItem: number | null,
  qty: number,
  floors: number,
  items: number,
): number => {
  switch (kind) {
    case 'qty':
      return basePrice * qty;
    case 'floors_items':
      return Math.max(0, floors - 2) * items * (perFloorItem ?? 0);
    case 'flat':
      return basePrice;
  }
};

/* ─── Sofa ─────────────────────────────────────────────────────────── */
// Real implementation lives in sofa-build.ts; re-exported via index.ts. Aliased
// type re-exports are used here for legacy `SofaCell` / `SofaDepth` import sites.

export type SofaCell = Cell;
export type SofaDepth = Depth;
export type { SofaProductPricing, SofaPriceResult };

/* ─── Mattress ─────────────────────────────────────────────────────── */

export interface MattressPricing {
  variants: { sizeId: string; price: number; active: boolean }[];
  /** Optional per-mattress extra-pillow price; falls back to a flat default if not set. */
  extraPillowPrice?: number;
}

export interface MattressPriceResult {
  base: number;
  pillowExtra: number;
  total: number;
  breakdown: string[];
}

const DEFAULT_EXTRA_PILLOW_PRICE = 80;

export const computeMattressPrice = (
  sizeId: string,
  freePillows: number,
  extraPillows: number,
  pricing: MattressPricing,
): MattressPriceResult => {
  const variant = pricing.variants.find((v) => v.sizeId === sizeId);
  if (!variant) {
    return { base: 0, pillowExtra: 0, total: 0, breakdown: [`Unknown size '${sizeId}'`] };
  }
  if (!variant.active) {
    return {
      base: 0,
      pillowExtra: 0,
      total: 0,
      breakdown: [`Size '${sizeId}' is inactive on this Model`],
    };
  }
  const base = variant.price;
  const pricePerExtra = pricing.extraPillowPrice ?? DEFAULT_EXTRA_PILLOW_PRICE;
  const pillowExtra = Math.max(0, extraPillows) * pricePerExtra;
  const total = base + pillowExtra;
  const breakdown = [
    `Mattress · ${sizeId}: RM ${base.toLocaleString('en-MY')}`,
  ];
  if (freePillows > 0) breakdown.push(`Free pillows × ${freePillows}: RM 0`);
  if (extraPillows > 0) {
    breakdown.push(`Extra pillows × ${extraPillows} @ RM ${pricePerExtra}: RM ${pillowExtra.toLocaleString('en-MY')}`);
  }
  return { base, pillowExtra, total, breakdown };
};

/* ─── Bedframe ─────────────────────────────────────────────────────── */

export interface BedframePricing {
  variants: { sizeId: string; price: number; active: boolean }[];
}

export const computeBedframePrice = (
  sizeId: string,
  pricing: BedframePricing,
): { total: number; breakdown: string[] } => {
  const variant = pricing.variants.find((v) => v.sizeId === sizeId);
  if (!variant || !variant.active) {
    return { total: 0, breakdown: [`Bedframe size '${sizeId}' unavailable`] };
  }
  return {
    total: variant.price,
    breakdown: [`Bedframe · ${sizeId}: RM ${variant.price.toLocaleString('en-MY')}`],
  };
};

/* ─── Whole-order recompute (TODO — Phase 2 step C) ────────────────── */

export interface OrderTotalResult {
  subtotal: number;
  addonTotal: number;
  total: number;
  perItem: { itemIdx: number; kind: string; title: string; total: number; breakdown: string[] }[];
}

export const computeOrderTotal = (
  /* eslint-disable @typescript-eslint/no-explicit-any */
  _order: any,
  _productsState: any,
  _addonsState: any,
  /* eslint-enable */
): OrderTotalResult => {
  // Wires together computeSofaPrice / computeMattressPrice / computeBedframePrice /
  // addonPrice for every cart item. Lands when POST /orders does server-side
  // recompute (PORT_DESIGN §5.2). Phase 2 step C.
  throw new Error('computeOrderTotal: not yet implemented (Phase 2 step C)');
};
