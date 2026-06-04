// ----------------------------------------------------------------------------
// Shared types + tiny pure helpers for the SalesOrderDetail card extraction.
//
// Task #61 (aggressive perf) — SalesOrderDetail.tsx was a 2,460-line monolith
// where every keystroke in ANY input re-rendered the entire tree because the
// parent re-rendered. Splitting the page into per-card files lets each card
// own its local form state — typing in Customer Name no longer re-renders
// LineItemsSection / TotalsCard / HistoryPanel.
//
// These types are the contract between the page (state orchestrator) and the
// cards (visual + local-state owners). Keep them dumb + serializable.
// ----------------------------------------------------------------------------

import type { CSSProperties } from 'react';
import { REQUIRED_VARIANT_AXES_BY_CATEGORY } from '@2990s/shared/so-variant-rule';

// PR-DRAFT-removal — DRAFT dropped from mfg_so_status (migration 0078).
export const STATUS_LIST = [
  'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP',
  'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED',
] as const;
export type SoStatus = typeof STATUS_LIST[number];

export type SoHeader = {
  doc_no: string;
  so_date: string;
  status: SoStatus;
  debtor_code: string | null;
  debtor_name: string;
  agent: string | null;
  sales_location: string | null;
  ref: string | null;
  po_doc_no: string | null;
  venue: string | null;
  branding: string | null;
  transfer_to: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
  phone: string | null;
  mattress_sofa_centi: number;
  bedframe_centi: number;
  accessories_centi: number;
  others_centi: number;
  mattress_sofa_cost_centi?: number;
  bedframe_cost_centi?:      number;
  accessories_cost_centi?:   number;
  others_cost_centi?:        number;
  local_total_centi: number;
  total_cost_centi: number;
  total_margin_centi: number;
  margin_pct_basis: number;
  line_count: number;
  // Delivery fee in sen, included in local_total_centi (migration 0133).
  delivery_fee_centi?: number;
  currency: string;
  note: string | null;
  customer_id: string | null;
  customer_state: string | null;
  customer_country: string | null;
  customer_po: string | null;
  customer_po_id: string | null;
  customer_po_date: string | null;
  customer_po_image_b64: string | null;
  customer_so_no: string | null;
  hub_id: string | null;
  hub_name: string | null;
  customer_delivery_date: string | null;
  internal_expected_dd: string | null;
  linked_do_doc_no: string | null;
  ship_to_address: string | null;
  bill_to_address: string | null;
  install_to_address: string | null;
  subtotal_sen: number | null;
  overdue: string | null;
  email: string | null;
  customer_type: string | null;
  salesperson_id: string | null;
  city: string | null;
  postcode: string | null;
  building_type: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  target_date: string | null;
  payment_method: string | null;
  installment_months: number | null;
  merchant_provider: string | null;
  approval_code: string | null;
  payment_date: string | null;
  deposit_centi: number;
  paid_centi: number;
};

export type SoItem = {
  id: string;
  doc_no: string;
  item_group: string;
  item_code: string;
  description: string | null;
  description2: string | null;
  uom: string;
  qty: number;
  unit_price_centi: number;
  discount_centi: number;
  total_centi: number;
  unit_cost_centi: number;
  line_cost_centi: number;
  line_margin_centi: number;
  variants: Record<string, unknown> | null;
  remark: string | null;
  cancelled: boolean;
  line_delivery_date: string | null;
  line_delivery_date_overridden: boolean;
  /* PR — Commander 2026-05-28: Stock fulfillment flag.
     Default 'PENDING'. Flipped to 'READY' when stock arrives (manual for
     MVP, auto-from-inventory in a follow-up). Drives the Stock Status
     chip column on the SO list + auto-advances the SO status to
     READY_TO_SHIP when every non-cancelled line is READY. */
  stock_status?: string;
};

/* PR-A — Imperative handle exposed by every editable sub-card so the page
   header's Save button can commit all cards in one mutation. Each card
   collects its current form snapshot via getPatch() and returns a partial
   payload that the page merges before calling updateHeader.mutate(). */
export type CardHandle = {
  /** Return the current form snapshot as a header-PATCH payload partial.
      May return null when the card has nothing to contribute (e.g. when
      it's in read-only mode). */
  getPatch: () => Record<string, unknown> | null;
  /** Revert to the snapshot derived from the latest `header` prop. */
  reset: () => void;
  /** Validate the local form. Returns an error message string if invalid,
      else null. The page aborts the Save if any card returns an error. */
  validate?: () => string | null;
};

export const ICON = { size: 16, strokeWidth: 1.75 } as const;
export const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

export const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/* Hoisted module-level style constants — preserve referential identity so
   React reconciliation skips host elements on re-render. */
export const TITLE_ICON_STYLE: CSSProperties = { color: 'var(--c-burnt)' };
export const TITLE_TOTAL_STYLE: CSSProperties = {
  marginLeft: 'var(--space-2)',
  fontFamily: 'var(--font-mark)',
  fontSize: 'var(--fs-18)',
  fontWeight: 800,
  fontStretch: '80%',
  color: 'var(--c-burnt)',
};
export const LOCK_BANNER_INNER_STYLE: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
};
export const VARIANT_WARN_BANNER_STYLE: CSSProperties = {
  background: 'rgba(184, 51, 31, 0.08)',
  border: '1px solid var(--c-festive-b, #B8331F)',
  color: 'var(--c-festive-b, #B8331F)',
  padding: 'var(--space-3) var(--space-4)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-13)',
};
export const VARIANT_WARN_LIST_STYLE: CSSProperties = { marginTop: 4, fontSize: 'var(--fs-12)' };
export const DATES_XOR_WARN_STYLE: CSSProperties = {
  background: 'rgba(184, 51, 31, 0.08)',
  border: '1px solid var(--c-festive-b, #B8331F)',
  color: 'var(--c-festive-b, #B8331F)',
  padding: '4px var(--space-2)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-11)',
  fontWeight: 600,
  marginTop: 'var(--space-2)',
};
export const EMERGENCY_HEADER_NOTE_STYLE: CSSProperties = {
  fontSize: 'var(--fs-12)', color: 'var(--fg-muted)',
};
export const TOTALS_KPI_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 'var(--space-3)',
  marginBottom: 'var(--space-3)',
  paddingBottom: 'var(--space-3)',
  borderBottom: '1px solid var(--line)',
};
export const TOTALS_KPI_VALUE_STYLE: CSSProperties = { fontSize: 'var(--fs-18)' };
export const HISTORY_NOTE_STYLE: CSSProperties = { fontStyle: 'italic' };

/* Variant-completeness reference map — derived from the shared
   so-variant-rule (2026-06-04) so this copy can't drift from the server 409
   gate again. Canonical (Backend-vocabulary) keys only; for checking a line,
   use missingVariantAxes from @2990s/shared (alias-aware: POS sofa lines
   carry depth / sofaLegHeight for the Seat / Leg axes). */
export const REQUIRED_BY_CATEGORY: Record<string, readonly string[]> =
  Object.fromEntries(
    Object.entries(REQUIRED_VARIANT_AXES_BY_CATEGORY).map(([g, axes]) => [
      g,
      axes.map((a) => a.key),
    ]),
  );
export const formatGroupRequirements = (g: string): string =>
  g === 'bedframe' ? 'Divan · Leg · Gap · Fabric' :
  g === 'sofa'     ? 'Seat · Leg · Fabric' : '';

export const LOCKED_STATUSES: readonly SoStatus[] = [
  'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED',
] as const;
