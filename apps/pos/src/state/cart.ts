import { create } from 'zustand';
import { summarizeSofaCells, type Cell, type Depth } from '@2990s/shared';

/**
 * Cart line snapshot. The `total` field is what we display in the cart and
 * what the POS submits to POST /orders. The server recomputes the total from
 * current pricing tables and rejects with 409 if it drifts more than 0.5%.
 */
export interface SofaConfigSnapshot {
  kind: 'sofa';
  productId: string;
  productName: string;
  bundleId?: string;     // set when Quick-Pick
  cells?: Cell[];        // set when Custom-build
  depth?: Depth;
  /** Per-Model upgrade label, stored so cartSummary can re-derive the
   *  "+ N <label>" suffix for Custom-build lines already in the cart. F3. */
  seatUpgradeLabel?: string | null;
  /** Upgrade footrest flag. false = auto-included headrest → invoice shows
   *  "+ N <label>" on a quick-pick line (F3). */
  seatUpgradeFootrest?: boolean;
  /** Chosen upholstery fabric + colour (spec 2026-05-24). fabricId/colourId
   *  feed the order POST (server validates + prices); the labels + hex are
   *  display snapshots so the cart/invoice render without a DB join. */
  fabricId?: string;
  colourId?: string;
  fabricLabel?: string;
  colourLabel?: string;
  colourHex?: string;
  /** Per-item fabric-tier SELLING add-on (whole MYR, migration 0124) already
   *  folded into `total`. Stored so the cart/handover can show it as a sub-line. */
  fabricTierDelta?: number;
  // Special Add-ons (migration 0134): codes (sent as variants.specials → server
  // prices from special_addons + gates) + chosen option-group labels + display.
  specialIds?: string[];
  specialLabels?: string[];
  specialChoices?: Record<string, string[]>;
  // PWP Code Voucher (Phase 2) — this sofa is redeemed at its combo PWP price via
  // a voucher code. `total` already reflects the PWP price. The server re-matches
  // the build against the code's reward combos + marks the code USED at Confirm.
  pwp?: boolean;
  pwpCode?: string;
  total: number;
  summary: string;       // e.g. "3+L · Bundle · Velvet/Sand"
}

export interface SizeConfigSnapshot {
  kind: 'size';
  productId: string;
  productName: string;
  sizeId: string;
  // Identity for PWP (换购) matching (0128) — a mattress line is a PWP trigger.
  // Optional: only the configurator populates them; legacy/restored lines omit.
  modelId?: string | null;  // product_models.id
  category?: string;        // UPPERCASE mfg category, e.g. 'MATTRESS'
  // PWP Code Voucher (0130) — a mattress redeemed at its PWP price via a voucher.
  // `total` already reflects the PWP base. Server re-validates + marks USED.
  pwp?: boolean;
  pwpCode?: string;
  pwpTriggerLabel?: string | null;
  total: number;
  summary: string;       // e.g. "Queen"
  /** Paid-extra add-ons attached to this configured line (e.g. extra pillows
   *  beyond the included free ones). NOT included_addons — those are derived
   *  from product.included_addons server-side and don't add to the price. */
  addonExtras?: { addonId: string; qty: number }[];
  // Special Add-ons (migration 0134): codes (sent as variants.specials → server
  // prices from special_addons + gates) + chosen option-group labels + display.
  specialIds?: string[];
  specialLabels?: string[];
  specialChoices?: Record<string, string[]>;
}

// Flat-priced products (single price per product — mattresses, bedframes, sofas
// without modular configuration). Server validates against products.flat_price.
// (Bug #2 fix)
export interface FlatConfigSnapshot {
  kind: 'flat';
  productId: string;
  productName: string;
  total: number;
  summary: string;       // e.g. "Flat price"
}

// Bedframe configurator (spec 2026-05-25). Field names mirror the Zod
// BedframeLineConfig so buildPostBody maps 1:1. Labels + hex are display
// snapshots for the cart/invoice; the server revalidates ids + reprices.
// sizeOther is a free-text special size (e.g. "200 x 200"), display-only.
export interface BedframeConfigSnapshot {
  kind: 'bedframe';
  productId: string;
  productName: string;
  sizeId: string;
  sizeOther?: string;
  colourId: string;
  colourLabel: string | null;
  colourHex?: string;
  // Fabric (migration 0124) — bedframe picks a fabric, then its colour (above).
  fabricId?: string;
  fabricLabel?: string;
  fabricTierDelta?: number;
  gapId?: string;
  legHeightId: string;
  divanHeightId?: string;
  totalHeightId?: string;
  // Special Add-ons (migration 0134): specialIds now holds special_addons CODES
  // (sent as variants.specials → server prices from special_addons + gates).
  // specialChoices = { code: [chosen option-group labels] } for the 追问 surcharge
  // + SO description. specialLabels stays for display.
  specialIds?: string[];
  specialChoices?: Record<string, string[]>;
  // Identity for PWP (换购) matching (0128) — a bedframe line is a PWP reward.
  modelId?: string | null;  // product_models.id
  category?: string;        // UPPERCASE mfg category, e.g. 'BEDFRAME'
  // PWP (换购, 0128) — this bedframe is redeemed at its PWP price against a
  // qualifying mattress in the same cart. `total` already reflects the PWP base
  // (+ fabric Δ). pwpTriggerLabel = the mattress it's bound to, for the invoice
  // sub-line "PWP price · 换购自 <Mattress>". Server re-validates the price.
  pwp?: boolean;
  pwpTriggerLabel?: string | null;
  // PWP Code Voucher (migration 0130) — the voucher code this reward redeems.
  // Same-cart: one of the cart's RESERVED codes (auto-picked when the toggle is
  // on). Cross-order: an AVAILABLE code entered in "Insert PWP Code". The server
  // marks it USED at order Confirm; printed on the SO.
  pwpCode?: string;
  // Display-label snapshots (parallel to the *Id fields) so the cart, printed
  // Sales Order, and Backend detail render the spec without a join.
  gapLabel?: string | null;
  legHeightLabel?: string | null;
  divanHeightLabel?: string | null;
  totalHeightLabel?: string | null;
  specialLabels?: string[];
  total: number;
  summary: string;       // e.g. "Queen · Sand · Gap 6\" · Leg 4\""
}

export type CartConfig =
  | SofaConfigSnapshot
  | SizeConfigSnapshot
  | FlatConfigSnapshot
  | BedframeConfigSnapshot;

export interface CartLine {
  key: string;
  qty: number;
  config: CartConfig;
}

interface CartState {
  lines: CartLine[];
  /** Set when the cart was loaded from a saved quote. The quote is consumed
   *  (deleted) only when the order is confirmed — NOT on load — so reviewing a
   *  quote never destroys the saved draft. Cleared on clear()/restore(). */
  sourceQuoteId: string | null;
  addConfigured: (config: CartConfig, opts?: { editingKey?: string }) => string;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  restore: (lines: CartLine[], sourceQuoteId?: string | null) => void;
}

/* ── Sofa-exclusivity rule (Commander 2026-05-30) ──────────────────────────
   A sofa is its own ticket: a cart holds EITHER sofas OR non-sofa products,
   never a mix. Multiple sofas together are fine. Mirrors the Sales Order
   backend guard (POST /mfg-sales-orders rejects a sofa mixed with a bedframe /
   mattress) — we enforce it here at add-time so the salesperson is stopped in
   the catalog, not at checkout. In 2990's catalog every sofa is modular
   (sofa_build → a sofa-configurator line, config.kind === 'sofa'), so kind is
   the reliable sofa signal. */
const isSofaConfig = (c: CartConfig): boolean => c.kind === 'sofa';

export const cartHasSofa = (lines: CartLine[]): boolean => lines.some((l) => isSofaConfig(l.config));
export const cartHasNonSofa = (lines: CartLine[]): boolean => lines.some((l) => !isSofaConfig(l.config));

/** Reason string if adding `config` would mix a sofa with non-sofa products
 *  (either direction), else null. Editing a line in place (editingKey) never
 *  conflicts — the line's category doesn't change. */
export const cartCategoryConflict = (
  lines: CartLine[],
  config: CartConfig,
  editingKey?: string,
): string | null => {
  if (editingKey) return null;
  if (isSofaConfig(config)) {
    return cartHasNonSofa(lines)
      ? 'Sofas are placed on their own order. Finish or clear the current items before adding a sofa.'
      : null;
  }
  return cartHasSofa(lines)
    ? 'Your cart has a sofa. Sofas are placed on their own order — finish or clear it before adding other products.'
    : null;
};

// In-memory store. Persistence moved off localStorage to the DB (pos_carts,
// WS1 2026-05-31) via useCartSync (lib/cart-sync.ts), so the cart follows the
// salesperson across devices and never bleeds to the next person on a shared
// tablet. The store API is unchanged — only the backing store moved.
export const useCart = create<CartState>()((set, get) => ({
  lines: [],
  sourceQuoteId: null,

  addConfigured(config, opts) {
    const editingKey = opts?.editingKey;
    if (editingKey && get().lines.some((l) => l.key === editingKey)) {
      set({ lines: get().lines.map((l) => (l.key === editingKey ? { ...l, config } : l)) });
      return editingKey;
    }
    // Sofa-exclusivity defense — the catalog disables conflicting cards so
    // this is rarely reached (only via a deep link to a configurator). It
    // is the single source of truth that guarantees the cart never holds a
    // sofa mixed with non-sofa products. No-op (don't add) on conflict.
    if (cartCategoryConflict(get().lines, config)) {
      return '';
    }
    const key = `cfg-${Math.random().toString(36).slice(2, 9)}`;
    set({ lines: [...get().lines, { key, qty: 1, config }] });
    return key;
  },

  setQty(key, qty) {
    if (qty < 1) {
      get().remove(key);
      return;
    }
    set({ lines: get().lines.map((l) => (l.key === key ? { ...l, qty } : l)) });
  },

  remove(key) {
    set({ lines: get().lines.filter((l) => l.key !== key) });
  },

  clear() {
    set({ lines: [], sourceQuoteId: null });
  },

  restore(lines, sourceQuoteId = null) {
    set({ lines: lines.map((l) => ({ ...l })), sourceQuoteId });
  },
}));

export const cartSubtotal = (lines: CartLine[]): number =>
  lines.reduce((sum, l) => sum + l.qty * l.config.total, 0);

export const cartItemCount = (lines: CartLine[]): number =>
  lines.reduce((sum, l) => sum + l.qty, 0);

/**
 * Display summary for a cart line. For Custom Build sofas (cells present) we
 * re-derive the label at render time so naming changes — e.g., dropping the
 * "(1A+1A)" composition jargon from bundle-matched lines — apply to items
 * already in the cart, not just newly added ones. Quick-Pick sofas, size-
 * configured items, and flat items keep their stored summary (it carries
 * extra context like L-facing direction or chosen size).
 */
export const cartSummary = (config: CartConfig): string => {
  if (
    config.kind === 'sofa' &&
    config.cells &&
    config.cells.length > 0 &&
    config.depth
  ) {
    return summarizeSofaCells(config.cells, config.depth, config.seatUpgradeLabel);
  }
  return config.summary;
};
