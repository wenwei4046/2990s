// Pricing math. SOLE source of truth — server side recompute on POST /orders
// imports the same functions as the client (per CLAUDE.md non-negotiable +
// PORT_DESIGN.md §5.2). DO NOT duplicate this logic anywhere.

// computeSofaPrice lives in sofa-build.ts (re-exported via index). Types only:
import type { Cell, Depth, SofaPriceResult, SofaProductPricing } from './sofa-build';
import { computeSofaPrice } from './sofa-build';

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

/* ─── Whole-order recompute (server-side on POST /orders) ──────────── */

export type SofaLineConfig = {
  kind: 'sofa';
  productId: string;
  bundleId?: string;
  cells?: Cell[];
  depth?: Depth;
};
export type SizeLineConfig = {
  kind: 'size';
  productId: string;
  sizeId: string;
  /** Paid extras attached to this size line (e.g. extra pillows beyond the
   *  free included ones). Server multiplies addons[id].price × qty. */
  addonExtras?: { addonId: string; qty: number }[];
};
export type FlatLineConfig = {
  kind: 'flat';
  productId: string;
};
export type OrderLineConfig = SofaLineConfig | SizeLineConfig | FlatLineConfig;

export interface OrderLineInput {
  qty: number;
  config: OrderLineConfig;
}

export interface ServerProductInfo {
  productId: string;
  pricingKind: 'sofa_build' | 'size_variants' | 'flat' | 'tbc';
  flatPrice: number | null;
  sofa?: SofaProductPricing;
  sizes?: { sizeId: string; price: number; active: boolean }[];
}

export interface OrderLineResult {
  productId: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  configJson: OrderLineConfig;
  breakdown: string[];
}

export interface OrderTotals {
  lines: OrderLineResult[];
  subtotal: number;
  addonTotal: number;
  total: number;
}

export type OrderTotalError =
  | { code: 'unknown_product'; productId: string }
  | { code: 'wrong_pricing_kind'; productId: string; expected: string; got: string }
  | { code: 'no_geometry_or_bundle'; productId: string }
  | { code: 'inactive_bundle'; productId: string; bundleId: string }
  | { code: 'inactive_size'; productId: string; sizeId: string }
  | { code: 'unknown_size'; productId: string; sizeId: string }
  | { code: 'unknown_addon'; productId: string; addonId: string }
  | { code: 'flat_price_missing'; productId: string };

export class OrderPricingError extends Error {
  detail: OrderTotalError;
  constructor(detail: OrderTotalError) {
    super(JSON.stringify(detail));
    this.detail = detail;
  }
}

/**
 * Server-side recompute. Throws OrderPricingError on any catalog mismatch.
 * Used by POST /orders BEFORE the client's clientTotal is trusted.
 */
export const computeOrderTotal = (
  lines: OrderLineInput[],
  productInfoById: Map<string, ServerProductInfo>,
  /** Optional addon price map, keyed by addon id. Required only when at least
   *  one size line submits addonExtras — the API loads addons table once and
   *  passes the price map here so the math stays purely functional. */
  addonPricesById?: Map<string, number>,
): OrderTotals => {
  const out: OrderLineResult[] = [];
  for (const line of lines) {
    const info = productInfoById.get(line.config.productId);
    if (!info) throw new OrderPricingError({ code: 'unknown_product', productId: line.config.productId });

    if (line.config.kind === 'sofa') {
      const cfg: SofaLineConfig = line.config;
      if (info.pricingKind !== 'sofa_build') {
        throw new OrderPricingError({ code: 'wrong_pricing_kind', productId: info.productId, expected: 'sofa_build', got: info.pricingKind });
      }
      if (!info.sofa) throw new OrderPricingError({ code: 'wrong_pricing_kind', productId: info.productId, expected: 'sofa_build', got: 'no_pricing_loaded' });

      let unitPrice = 0;
      const breakdown: string[] = [];

      if (cfg.cells && cfg.cells.length > 0) {
        const result: SofaPriceResult = computeSofaPrice(cfg.cells, cfg.depth ?? '24', info.sofa);
        unitPrice = result.total;
        for (const g of result.groups) {
          breakdown.push(`${g.signature || 'group'} · ${g.basis}: RM ${g.finalPrice.toLocaleString('en-MY')}`);
        }
      } else if (cfg.bundleId) {
        const wantBundleId = cfg.bundleId;
        const bundle = info.sofa.bundles.find((b) => b.bundleId === wantBundleId);
        if (!bundle) throw new OrderPricingError({ code: 'inactive_bundle', productId: info.productId, bundleId: wantBundleId });
        if (!bundle.active) throw new OrderPricingError({ code: 'inactive_bundle', productId: info.productId, bundleId: wantBundleId });
        unitPrice = bundle.price;
        breakdown.push(`Bundle ${bundle.bundleId}: RM ${bundle.price.toLocaleString('en-MY')}`);
      } else {
        throw new OrderPricingError({ code: 'no_geometry_or_bundle', productId: info.productId });
      }

      out.push({
        productId: info.productId,
        qty: line.qty,
        unitPrice,
        lineTotal: unitPrice * line.qty,
        configJson: cfg,
        breakdown,
      });
    } else if (line.config.kind === 'size') {
      // size_variants
      const cfg: SizeLineConfig = line.config;
      if (info.pricingKind !== 'size_variants') {
        throw new OrderPricingError({ code: 'wrong_pricing_kind', productId: info.productId, expected: 'size_variants', got: info.pricingKind });
      }
      const wantSizeId = cfg.sizeId;
      const variant = info.sizes?.find((s) => s.sizeId === wantSizeId);
      if (!variant) throw new OrderPricingError({ code: 'unknown_size', productId: info.productId, sizeId: wantSizeId });
      if (!variant.active) throw new OrderPricingError({ code: 'inactive_size', productId: info.productId, sizeId: wantSizeId });

      // Add paid extras (e.g. pillow upgrades). Empty / missing → just the size base.
      let extrasTotal = 0;
      const breakdown = [`Size ${cfg.sizeId}: RM ${variant.price.toLocaleString('en-MY')}`];
      if (cfg.addonExtras && cfg.addonExtras.length > 0) {
        for (const e of cfg.addonExtras) {
          const price = addonPricesById?.get(e.addonId);
          if (price == null) {
            throw new OrderPricingError({ code: 'unknown_addon', productId: info.productId, addonId: e.addonId });
          }
          const lineExtra = price * e.qty;
          extrasTotal += lineExtra;
          breakdown.push(`Add-on ${e.addonId} × ${e.qty} @ RM ${price}: RM ${lineExtra.toLocaleString('en-MY')}`);
        }
      }

      const unitPrice = variant.price + extrasTotal;
      out.push({
        productId: info.productId,
        qty: line.qty,
        unitPrice,
        lineTotal: unitPrice * line.qty,
        configJson: cfg,
        breakdown,
      });
    } else {
      // flat — single price per product. (Bug #2)
      const cfg: FlatLineConfig = line.config;
      if (info.pricingKind !== 'flat') {
        throw new OrderPricingError({ code: 'wrong_pricing_kind', productId: info.productId, expected: 'flat', got: info.pricingKind });
      }
      if (info.flatPrice == null) {
        throw new OrderPricingError({ code: 'flat_price_missing', productId: info.productId });
      }
      out.push({
        productId: info.productId,
        qty: line.qty,
        unitPrice: info.flatPrice,
        lineTotal: info.flatPrice * line.qty,
        configJson: cfg,
        breakdown: [`Flat: RM ${info.flatPrice.toLocaleString('en-MY')}`],
      });
    }
  }

  const subtotal = out.reduce((s, l) => s + l.lineTotal, 0);
  return { lines: out, subtotal, addonTotal: 0, total: subtotal };
};

/** True when the client-submitted total drifts more than 0.5% from server. */
export const pricingDriftExceeds = (clientTotal: number, serverTotal: number): boolean => {
  if (serverTotal <= 0) return clientTotal !== 0;
  const drift = Math.abs(clientTotal - serverTotal) / serverTotal;
  return drift > 0.005;
};
