// Pricing math. SOLE source of truth — server side recompute on POST /orders
// imports the same functions as the client (per CLAUDE.md non-negotiable +
// PORT_DESIGN.md §5.2). DO NOT duplicate this logic anywhere.
//
// Phase 1 lift target: full implementations of computeSofaPrice, computeMattressPrice,
// computeBedframePrice, computeOrderTotal. Stubs below match prototype function
// signatures from prototype/pos-sofa-config.jsx + pos-handover.jsx.

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

// --- Stubs below — port from prototype during Phase 1 ---

export interface SofaCell {
  moduleId: string;
  x: number;
  y: number;
  rot: 0 | 90 | 180 | 270;
  recliners?: { seatIdx: number; open: boolean }[];
}

export interface SofaProductPricing {
  compartments: { compartmentId: string; price: number; active: boolean }[];
  bundles: { bundleId: string; price: number; active: boolean; signature: string }[];
  reclinerUpgradePrice: number;
}

export interface SofaPriceResult {
  groups: {
    closed: boolean;
    reason?: string;
    bundle?: { id: string; price: number };
    bundlePrice: number;
    aLaCarteTotal: number;
    reclinerCount: number;
    reclinerExtra: number;
    finalPrice: number;
  }[];
  total: number;
}

export const computeSofaPrice = (
  _cells: SofaCell[],
  _pricing: SofaProductPricing,
): SofaPriceResult => {
  // TODO: port from prototype/pos-sofa-config.jsx — group detection, closure check,
  // arm-collision validation, bundle auto-detect, recliner upgrades.
  // Phase 1 acceptance gate (PORT_DESIGN.md §10.10 → Phase 1 redefined).
  throw new Error('computeSofaPrice: not yet implemented (Phase 1)');
};

export interface MattressPricing {
  variants: { sizeId: string; price: number; active: boolean }[];
}

export const computeMattressPrice = (
  _sizeId: string,
  _freePillows: number,
  _extraPillows: number,
  _pricing: MattressPricing,
): { base: number; pillowExtra: number; total: number; breakdown: string[] } => {
  throw new Error('computeMattressPrice: not yet implemented (Phase 1)');
};

export const computeBedframePrice = (
  _sizeId: string,
  _pricing: { variants: { sizeId: string; price: number; active: boolean }[] },
): { total: number } => {
  throw new Error('computeBedframePrice: not yet implemented (Phase 1)');
};

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
  throw new Error('computeOrderTotal: not yet implemented (Phase 1)');
};
