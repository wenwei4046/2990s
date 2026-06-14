// POS → Backend SO handover (Task #70 · Phase 2 of 2990S-PORTAL-PLAN.md §7.2).
//
// The POS confirm screen captures the customer + address + emergency contact +
// target date + payment + cart, then forwards the whole thing to the Backend's
// manufacturing sales order endpoint (POST /mfg-sales-orders) so the order
// coordinator can pick it up. Replaces the prototype's localStorage-bridge
// hand-off and the legacy POS-only retail /orders flow for B2B/handover orders.
//
// Body shape contract (camelCase — API maps to snake_case):
//   debtorName, email, customerType, salespersonId, phone,
//   address1, address2, city, postcode, customerState, buildingType,
//   emergencyContactName, emergencyContactPhone, emergencyContactRelationship,
//   targetDate, customerDeliveryDate, internalExpectedDd, paymentMethod,
//   items: [...]
//
// On success the server returns { docNo: 'SO-NNNNNN' } and the caller
// navigates to the handover thank-you screen with that docNo. On failure the
// API returns { error, reason } which we surface verbatim — the Handover page
// renders it under the StepFooter.
//
// Mirrors the pattern in apps/backend/src/lib/flow-queries.ts:
// `useCreateMfgSalesOrder` (camelCase POST + 201 → { docNo }).

import { useMutation } from '@tanstack/react-query';
import { orderSofaCellsLeftToRight } from '@2990s/shared/sofa-build';
import { supabase } from './supabase';
import type { CartLine, CartConfig } from '../state/cart';
import type { CatalogProduct } from './queries';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/* ─── Types ─────────────────────────────────────────────────────────── */

export interface SoCreatedResponse {
  /** SO doc no, e.g. "SO-009042". HOUZS pattern, server-generated. */
  docNo: string;
}

export interface PosHandoffPayload {
  /** Customer header — maps to debtor_name in the SO table. */
  debtorName: string;
  email?: string;
  /** Value from the maintained customer_type dropdown (so_dropdown_options),
   *  e.g. 'NEW' / 'EXISTING'. Free string — admins can add options. */
  customerType?: string;
  /** auth.users.id of the sales staff who took the order. */
  salespersonId?: string;
  /** Storage form (E.164 if MY); server normalises defensively. */
  phone?: string;

  /* Address (delivery). */
  address1?: string;
  address2?: string;
  city?: string;
  postcode?: string;
  customerState?: string;
  /** Value from the maintained building_type dropdown, e.g. 'Condo' / 'Landed'. */
  buildingType?: string;
  /** Billing address as a single line, sent ONLY when it differs from the
   *  delivery address. Maps to the SO's existing `bill_to_address` column (the
   *  coordinator sees it on the SO detail page). Omitted when billing == delivery. */
  billToAddress?: string;

  /* Emergency contact. */
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;

  /* Dates. */
  /** Customer's target delivery (ISO YYYY-MM-DD). */
  targetDate?: string;
  /** Same value, threaded as the SO's customer_delivery_date column so the
   *  master-follower cascade in mfg-sales-orders gives every line this date.
   *  We send both because target_date is the POS handover field; coordinators
   *  edit customer_delivery_date downstream as the operational date. */
  customerDeliveryDate?: string;
  /** Factory start ("Process Date") — when production should begin, so a far-out
   *  delivery doesn't pull stock too early. ISO YYYY-MM-DD. Maps to the SO's
   *  internal_expected_dd column. The API requires this and customerDeliveryDate
   *  to be sent together (or both omitted) and Process ≤ Delivery. */
  internalExpectedDd?: string;

  /** Free-text special instructions captured at handover (lift available, leave
   *  at concierge, etc.). Maps to the SO's existing `note` column — the
   *  coordinator reads + edits it on the SO detail page. */
  note?: string;
  /** Customer signature captured on the handover pad, as a data URL
   *  (image/png;base64,…). Maps to the SO's signature_b64 column (migration
   *  0142). Omitted when unsigned. */
  signatureB64?: string;
  /** R2 upload-session id for the payment slip (from /slips/init + confirm). The
   *  server resolves it to the committed R2 key and attaches it to the SO
   *  (slip_key, migration 0143) so the coordinator sees the payment proof.
   *  Omitted when no slip was uploaded. */
  uploadSessionId?: string;

  /* Payment. */
  paymentMethod?: 'merchant' | 'transfer' | 'installment' | 'cash';
  /** Term in months, parsed from the maintained installment_plan options. */
  installmentMonths?: number;
  /** Value from the maintained payment_merchant dropdown (bank / terminal). */
  merchantProvider?: string;
  approvalCode?: string;
  /** Deposit / amount collected at handover in centi-MYR (sen). */
  depositCenti?: number;
  /** Split payment (Loo 2026-06-06) — when the handover collected SEVERAL
   *  transactions (e.g. half cash + half card), every transaction rides the
   *  create payload and the server books each as an is_deposit ledger row
   *  with deposit_centi = the sum. Strictly validated server-side (400
   *  invalid_payments on a bad row). Omitted for the ordinary single
   *  payment — the legacy depositCenti path then runs unchanged. */
  payments?: Array<{
    method: 'merchant' | 'transfer' | 'installment' | 'cash';
    /** Centi-MYR. */
    amountCenti: number;
    /** Spec D4 — every split payment carries its own slip upload session.
     *  Required server-side (the API books one slip per payment row). */
    uploadSessionId: string;
    approvalCode?: string;
    merchantProvider?: string;
    installmentMonths?: number;
  }>;

  /* Delivery fee (migration 0133). POS handover opts the SO into the
   *  server-recomputed delivery fee (base + cross-category + special-model +
   *  additional). Without this flag the SO charges no delivery — backend-
   *  authored SOs stay unaffected. */
  applyDeliveryFee?: boolean;
  /** Free-form delivery fee keyed by sales at handover, whole MYR. Server
   *  clamps negatives to 0 and scales to sen. */
  additionalDeliveryFee?: number;
  /** Cross-category follow-up: the earlier SO's doc_no sales typed at handover.
   *  The server validates it and charges this SO the reduced cross / special-
   *  cross delivery rate. Migration 0141. */
  crossCategorySourceDocNo?: string;

  /* Handover add-ons (SO-SKU spec P2, §4.2). The SELECTION only — ids +
   * quantities; the server re-prices each from the addons table (never the
   * client) and books them as SVC-DISPOSE-* / SVC-LIFT-CARRY SERVICE lines.
   * lift carries floorsCount/itemsCount (first 2 floors free, RM100 per
   * chargeable floor·item — D6). Omitted when nothing selected; an old PWA
   * that doesn't send it simply books no add-on lines (back-compat). */
  addons?: Array<{
    id: string;
    qty?: number;
    floorsCount?: number;
    itemsCount?: number;
  }>;

  /* Items. */
  items: PosHandoffItem[];
}

export interface PosHandoffItem {
  itemCode: string;
  itemGroup: 'sofa' | 'bedframe' | 'mattress' | 'accessory' | 'others';
  description: string;
  qty: number;
  /** Centi-MYR. */
  unitPriceCenti: number;
  /** Centi-MYR. */
  discountCenti: number;
  /** Freeform per-line variant snapshot — sofa cells/fabric/colour, bedframe
   *  size/colour/leg-height/gap/etc. Coordinator-side SoLineCard renders this
   *  into the bedframe / sofa variants grid (see apps/backend SoLineCard). */
  variants: Record<string, unknown> | null;
  /** PWP Code Voucher (migration 0130) — the cart line's stable key. NOT
   *  persisted on the SO line; the server uses it at Confirm to flip this
   *  order's un-applied RESERVED codes (keyed by cart_line_key) to AVAILABLE. */
  cartLineKey?: string;
}

export interface PosHandoffError {
  /** Machine-readable error string from the API (e.g. 'customer_name_required',
   *  'insert_failed', 'items_insert_failed'). */
  error: string;
  /** Optional underlying reason — usually a Postgres / Supabase error message. */
  reason?: string;
  /** Some 409s (e.g. variants_incomplete) explain themselves via `message`
   *  instead of `reason` — surface either. */
  message?: string;
  /** variants_incomplete detail: which lines miss which variant axes. Keys are
   *  the Backend canonical names (seatHeight / legHeight / gap / …). */
  offenders?: Array<{ id?: string; itemCode: string; group: string; missing: string[] }>;
  /** pricing_drift detail — which line drifted and by how much (sen). */
  itemCode?: string;
  client?: number;
  server?: number;
  /** variant_not_allowed detail (apps/api/src/lib/allowed-options-check.ts):
   *  WHICH variant axis the line carried that the Model's allowed_options pool
   *  rejects, the offending value, and the pool it had to be in. Surfaced so
   *  sales can Edit the line to an allowed option instead of staring at the
   *  bare code (the 2026-06-08 handover failure showed only the error name). */
  field?: string;
  value?: string;
  allowed?: string[];
}

/** Human-friendly labels for the allowed-options axes the API gates on. Keep in
 *  step with the `field` values returned by checkAllowedOptions (server). */
const VARIANT_FIELD_LABELS: Record<string, string> = {
  size_code:    'size',
  compartment:  'compartment',
  divan_height: 'divan height',
  total_height: 'total height',
  gap:          'gap',
  leg_height:   'leg height',
  seat_size:    'seat size',
  specials:     'special add-on',
  fabric:       'fabric',
};

export class PosHandoffApiError extends Error {
  payload: PosHandoffError;
  status: number;
  constructor(status: number, payload: PosHandoffError) {
    super(payload.reason ?? payload.message ?? payload.error ?? `POST /mfg-sales-orders failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

/** One human line for the StepFooter error strip. `variants_incomplete`
 *  offenders read as "LOTTI-1A(LHF): missing seatHeight, legHeight" so sales
 *  can fix the line (Edit in cart) instead of staring at a bare error code —
 *  the 2026-06-04 handover failure showed only "variants_incomplete". */
export const describePosHandoffError = (payload: PosHandoffError): string => {
  /* variant_not_allowed names the offending axis + value + the Model's allowed
     pool, so sales can Edit the line to a valid option (the 2026-06-08 failure
     showed only "variant_not_allowed" — nobody could tell WHICH variant). The
     server (allowed-options-check.ts) always sends field + value; allowed +
     itemCode are best-effort. */
  if (payload.error === 'variant_not_allowed' && payload.field) {
    const label = VARIANT_FIELD_LABELS[payload.field] ?? payload.field;
    const where = payload.itemCode ? `${payload.itemCode}: ` : '';
    const pool = (payload.allowed ?? []).length > 0
      ? ` — allowed: ${payload.allowed!.join(', ')}`
      : '';
    return `Order placement failed: variant_not_allowed — ${where}`
      + `this Model doesn't allow ${label} "${payload.value ?? ''}"${pool}.`
      + ` Edit the line and pick an allowed option.`;
  }
  const detail = payload.reason ?? payload.message;
  const offenders = (payload.offenders ?? [])
    .map((o) => `${o.itemCode}: missing ${o.missing.join(', ')}`)
    .join('; ');
  /* pricing_drift names the offending line + both figures, so sales can see
     WHICH item the server re-priced differently (the 2026-06-05 PWP failure
     showed only the bare one-liner). Sen → whole RM for the strip. */
  const drift = payload.error === 'pricing_drift' && payload.itemCode
    ? ` (${payload.itemCode}: tablet RM ${Math.round((payload.client ?? 0) / 100).toLocaleString('en-MY')}`
      + ` vs server RM ${Math.round((payload.server ?? 0) / 100).toLocaleString('en-MY')})`
    : '';
  return `Order placement failed: ${payload.error}`
    + (detail ? ` — ${detail}` : '')
    + (offenders ? ` (${offenders})` : '')
    + drift;
};

/* ─── Item marshalling ──────────────────────────────────────────────── */

/** Map a POS cart line's CartConfig.kind → SO item_group. The Backend's
 *  SoLineCard / SalesOrderDetail switches on this string to decide which
 *  variants grid to render (sofa vs bedframe vs mattress). It also drives the
 *  delivery-fee deliverable-category set (sofa/mattress/bedframe) + revenue
 *  bucketing.
 *
 *  The cart line itself carries the mfg `category` (set by the configurator on
 *  size + bedframe lines for PWP), so we trust THAT first — the catalog lookup
 *  (`product.category`) misses for size-variant SKUs in production (`products`
 *  is empty; the SKU id isn't a catalog card), which used to bucket every
 *  mattress as 'others' → 0 delivery fee + wrong revenue split. A `size` line
 *  with no resolvable category is almost always a mattress. */
export const inferItemGroup = (
  config: CartConfig,
  product: CatalogProduct | undefined,
): PosHandoffItem['itemGroup'] => {
  if (config.kind === 'sofa') return 'sofa';
  if (config.kind === 'bedframe') return 'bedframe';
  const fromConfig = 'category' in config && config.category ? String(config.category).toLowerCase() : '';
  const categoryId = fromConfig || (product?.category?.id?.toLowerCase() ?? '');
  if (categoryId.includes('mattress')) return 'mattress';
  if (categoryId.includes('sofa')) return 'sofa';
  if (categoryId.includes('bedframe')) return 'bedframe';
  if (categoryId.includes('accessor') || categoryId.includes('addon')) return 'accessory';
  // A size-priced line we couldn't classify is a mattress (sofas/bedframes have
  // their own kinds). Keeps delivery + revenue correct when the catalog is empty.
  if (config.kind === 'size') return 'mattress';
  return 'others';
};

/** Build the `variants` JSON column for one cart line. The shape matches what
 *  apps/backend SoLineCard expects per category:
 *    sofa:     { bundleId?, cells?, depth?, fabricId?, fabricLabel?,
 *                colourId?, colourLabel?, seatUpgradeLabel?, seatUpgradeFootrest? }
 *    bedframe: { sizeId, sizeOther?, colourId?, colourLabel?, gap?, gapLabel?,
 *                legHeight?, legHeightLabel?, divanHeight?, divanHeightLabel?,
 *                totalHeight?, totalHeightLabel?, specialIds?, specialLabels? }
 *    size:     { sizeId, addonExtras? }
 *    flat:     null  (no variants)
 *  We snapshot every label too so the Backend doesn't need a join to render
 *  the customer-visible spec on the SO detail page. */
const buildVariants = (config: CartConfig): Record<string, unknown> | null => {
  if (config.kind === 'sofa') {
    const v: Record<string, unknown> = {};
    if (config.bundleId)        v.bundleId = config.bundleId;
    if (config.cells)           v.cells = config.cells;
    if (config.depth)           v.depth = config.depth;
    if (config.seatUpgradeLabel != null)    v.seatUpgradeLabel = config.seatUpgradeLabel;
    if (config.seatUpgradeFootrest != null) v.seatUpgradeFootrest = config.seatUpgradeFootrest;
    if (config.fabricId)        v.fabricId = config.fabricId;
    if (config.fabricLabel)     v.fabricLabel = config.fabricLabel;
    if (config.colourId)        v.colourId = config.colourId;
    if (config.colourLabel)     v.colourLabel = config.colourLabel;
    if (config.colourHex)       v.colourHex = config.colourHex;
    // The colour code IS the procurement fabric_code (fabric_colours.colour_id =
    // fabric_trackings.fabric_code, e.g. "CG-002"). Send it as fabricCode so the
    // server resolves the cost row, satisfies the required-fabricCode variant
    // rule, and enforces the Model's allowed fabric pool. fabricId stays the
    // series ('CG') that drives the SELLING tier add-on.
    if (config.colourId)        v.fabricCode = config.colourId;
    // Sofa leg height (Loo 2026-06-03) — server prices it from the sofaLegHeights
    // SELLING pool + gates it against the Model's leg_heights (allowed_options).
    if (config.sofaLegHeight)   v.sofaLegHeight = config.sofaLegHeight;
    // PWP Code Voucher (Phase 2) — sofa redeemed at its combo PWP price. The
    // server re-matches the build vs the code's reward combos + marks it USED.
    if (config.pwp) {
      v.pwp = true;
      if (config.pwpCode) v.pwpCode = config.pwpCode;
    }
    // Special Add-ons (migration 0134) — codes → variants.specials (server prices
    // from special_addons + gates) + chosen option-group labels for the 追问.
    if (config.specialIds && config.specialIds.length > 0) {
      v.specials = config.specialIds;
      v.specialIds = config.specialIds;
    }
    if (config.specialLabels && config.specialLabels.length > 0) v.specialLabels = config.specialLabels;
    if (config.specialChoices && Object.keys(config.specialChoices).length > 0) v.specialChoices = config.specialChoices;
    if (config.remark?.trim())          v.remark = config.remark.trim();
    if (config.extraAddonNote?.trim())  v.extraAddonNote = config.extraAddonNote.trim();
    if ((config.extraAddonAmountRM ?? 0) > 0) v.extraAddonAmountRM = config.extraAddonAmountRM;
    if (config.summary)         v.summary = config.summary;
    return Object.keys(v).length > 0 ? v : null;
  }
  if (config.kind === 'bedframe') {
    // colourId optional since 2026-06-11 (fabric "confirm later", same as the
    // sofa rule) — omitted fabric keys leave the SO's fabricCode axis open;
    // so-variant-rule blocks any Processing date until a coordinator fills it.
    const v: Record<string, unknown> = {
      sizeId: config.sizeId,
    };
    if (config.colourId)              v.colourId = config.colourId;
    if (config.fabricId)              v.fabricId = config.fabricId;
    if (config.fabricLabel)           v.fabricLabel = config.fabricLabel;
    // PWP (换购) — the salesperson redeemed this bed frame at its PWP price via a
    // voucher code (migration 0130). The server re-validates the code + marks it
    // USED at Confirm before locking the PWP base; pwpTriggerLabel is a display
    // snapshot, pwpCode is the voucher (persisted → printed on the SO).
    if (config.pwp) {
      v.pwp = true;
      if (config.pwpCode)             v.pwpCode = config.pwpCode;
      if (config.pwpTriggerLabel)     v.pwpTriggerLabel = config.pwpTriggerLabel;
    }
    // colourId is the fabric colour code (fabric_colours.colour_id) now that
    // bedframe picks fabric → colour. Mirror it to fabricCode for the server's
    // cost lookup + required-fabricCode rule + allowed-fabric gate.
    if (config.colourId)              v.fabricCode = config.colourId;
    if (config.sizeOther)             v.sizeOther = config.sizeOther;
    if (config.colourLabel != null)   v.colourLabel = config.colourLabel;
    if (config.colourHex)              v.colourHex = config.colourHex;
    // The SO API validates (allowed-options), prices (maintenance config), and
    // renders (Backend GRN) these variant fields by their human LABEL — the
    // option `value` like `4"`, never the slug id `leg-4`. Send the label so a
    // restricted Model (e.g. leg_heights) doesn't 409 with variant_not_allowed.
    // Keep the *Label fields too; the SO detail card reads either.
    if (config.gapId)                 v.gap = config.gapLabel ?? config.gapId;
    if (config.gapLabel != null)      v.gapLabel = config.gapLabel;
    if (config.legHeightId)           v.legHeight = config.legHeightLabel ?? config.legHeightId;
    if (config.legHeightLabel != null) v.legHeightLabel = config.legHeightLabel;
    if (config.divanHeightId)         v.divanHeight = config.divanHeightLabel ?? config.divanHeightId;
    if (config.divanHeightLabel != null) v.divanHeightLabel = config.divanHeightLabel;
    if (config.totalHeightId)         v.totalHeight = config.totalHeightLabel ?? config.totalHeightId;
    if (config.totalHeightLabel != null) v.totalHeightLabel = config.totalHeightLabel;
    // Special Add-ons (migration 0134): specialIds holds special_addons CODES.
    // Send them ALSO as variants.specials — the field the server prices from
    // (special_addons pool) + the allowed-options gate validates. specialChoices
    // carries the chosen option-group labels for the 追问 surcharge + SO description.
    if (config.specialIds && config.specialIds.length > 0) {
      v.specialIds = config.specialIds;
      v.specials = config.specialIds;
    }
    if (config.specialLabels && config.specialLabels.length > 0) v.specialLabels = config.specialLabels;
    if (config.specialChoices && Object.keys(config.specialChoices).length > 0) v.specialChoices = config.specialChoices;
    if (config.remark?.trim())          v.remark = config.remark.trim();
    if (config.extraAddonNote?.trim())  v.extraAddonNote = config.extraAddonNote.trim();
    if ((config.extraAddonAmountRM ?? 0) > 0) v.extraAddonAmountRM = config.extraAddonAmountRM;
    if (config.summary)               v.summary = config.summary;
    return v;
  }
  if (config.kind === 'size') {
    const v: Record<string, unknown> = { sizeId: config.sizeId };
    if (config.addonExtras && config.addonExtras.length > 0) v.addonExtras = config.addonExtras;
    // PWP (换购) — a mattress redeemed at its PWP price via a voucher code. The
    // server re-validates the code + marks it USED at Confirm.
    if (config.pwp) {
      v.pwp = true;
      if (config.pwpCode) v.pwpCode = config.pwpCode;
      if (config.pwpTriggerLabel) v.pwpTriggerLabel = config.pwpTriggerLabel;
    }
    // Special Add-ons (migration 0134) — mattress add-ons (engine now prices
    // MATTRESS specials). codes → variants.specials + chosen choices.
    if (config.specialIds && config.specialIds.length > 0) {
      v.specials = config.specialIds;
      v.specialIds = config.specialIds;
    }
    if (config.specialLabels && config.specialLabels.length > 0) v.specialLabels = config.specialLabels;
    if (config.specialChoices && Object.keys(config.specialChoices).length > 0) v.specialChoices = config.specialChoices;
    if (config.remark?.trim())          v.remark = config.remark.trim();
    if (config.extraAddonNote?.trim())  v.extraAddonNote = config.extraAddonNote.trim();
    if ((config.extraAddonAmountRM ?? 0) > 0) v.extraAddonAmountRM = config.extraAddonAmountRM;
    if (config.summary)               v.summary = config.summary;
    return v;
  }
  // flat — nothing to capture beyond the product itself.
  return null;
};

/** Map a size-library id (mattress/bedframe picker vocab) → mfg size_code.
 *  Inverse of MFG_SIZE_CODE_TO_LIB in queries.ts. Only the 4 standard sizes
 *  are pickable in POS, so this covers every cart-line sizeId. */
const SIZE_LIB_TO_MFG: Record<string, string> = {
  king: 'K', queen: 'Q', single: 'S', 'super-single': 'SS',
};

interface MfgCodeRow {
  id: string;
  code: string;
  model_id: string | null;
  category: string;
  size_code: string | null;
}

/** What fetchItemCodeMap resolves per cart line: the bookable mfg code +
 *  the clean Model name (product_models.name) for the SO line description. */
export interface SoLineResolution {
  codeByKey: Map<string, string>;
  modelNameByKey: Map<string, string>;
}

/** Resolve the real mfg_products.code an SO line should book, given the line's
 *  config, its mfg row (looked up by productId), and that Model's sibling SKUs.
 *
 *  Why this exists: the POS cart stores `productId` = an mfg_products.id
 *  (`mfg-xxxx`), but the Sales Order API validates + reprices against
 *  mfg_products.CODE (e.g. "2990 AKKA-FIRM MATT (K)"). For mattress / bedframe
 *  each size is its OWN SKU/code, so we resolve the size-specific sibling by
 *  matching the chosen sizeId → size_code. Sofas / flat lines book the row's
 *  own code (sofas reprice from module SKUs server-side; flat is single-SKU).
 *  Returns undefined when the id isn't a known mfg row — caller falls back. */
export const pickSoItemCode = (
  config: CartConfig,
  baseRow: MfgCodeRow | undefined,
  siblings: Array<{ code: string; size_code: string | null }>,
): string | undefined => {
  if (!baseRow) return undefined;
  const sizeId = config.kind === 'size' || config.kind === 'bedframe' ? config.sizeId : null;
  if (sizeId && baseRow.model_id) {
    const want = SIZE_LIB_TO_MFG[sizeId];
    if (want) {
      const sib = siblings.find((s) => (s.size_code ?? '').toUpperCase() === want);
      if (sib) return sib.code;
    }
  }
  return baseRow.code;
};

/** Resolve each cart line's bookable mfg code + clean Model name. Two reads:
 *  (1) the cart's mfg rows by id (+ their Model's name via the FK embed),
 *  (2) their Models' sibling SKUs (only when a size-variant line needs the
 *  size-specific code). The legacy `products` catalog is empty in production,
 *  so this — not product.sku — is the real itemCode source the SO handover
 *  depends on. The Model name feeds the sofa SO line description
 *  ("Annsa · 1A(LHF) + 1A(RHF)", Chairman 2026-06-03) — without it the
 *  description fell back to the lead per-module SKU name. */
export const fetchItemCodeMap = async (lines: CartLine[]): Promise<SoLineResolution> => {
  const codeByKey = new Map<string, string>();
  const modelNameByKey = new Map<string, string>();
  const result: SoLineResolution = { codeByKey, modelNameByKey };
  const productIds = [...new Set(lines.map((l) => l.config.productId).filter(Boolean))];
  if (productIds.length === 0) return result;

  const { data: baseData } = await supabase
    .from('mfg_products')
    .select('id, code, model_id, category, size_code, product_models:model_id ( name )')
    .in('id', productIds);
  type BaseRow = MfgCodeRow & {
    // FK embed comes back object or array depending on the cached schema
    // cardinality (same defensive coercion as useMfgCatalog).
    product_models: { name: string } | Array<{ name: string }> | null;
  };
  const baseRows = ((baseData ?? []) as unknown as BaseRow[]);
  const byId = new Map<string, BaseRow>(baseRows.map((r) => [r.id, r]));

  // Siblings only matter for size-variant lines (mattress / bedframe).
  const modelIds = [...new Set(
    lines
      .filter((l) => l.config.kind === 'size' || l.config.kind === 'bedframe')
      .map((l) => byId.get(l.config.productId)?.model_id)
      .filter((m): m is string => Boolean(m)),
  )];
  const sibsByModel = new Map<string, Array<{ code: string; size_code: string | null }>>();
  if (modelIds.length > 0) {
    const { data: sibData } = await supabase
      .from('mfg_products')
      .select('code, model_id, size_code')
      .in('model_id', modelIds);
    for (const s of (sibData ?? []) as Array<{ code: string; model_id: string; size_code: string | null }>) {
      const arr = sibsByModel.get(s.model_id) ?? [];
      arr.push({ code: s.code, size_code: s.size_code });
      sibsByModel.set(s.model_id, arr);
    }
  }

  for (const l of lines) {
    const base = byId.get(l.config.productId);
    const sibs = base?.model_id ? sibsByModel.get(base.model_id) ?? [] : [];
    const code = pickSoItemCode(l.config, base, sibs);
    if (code) codeByKey.set(l.key, code);
    const m = Array.isArray(base?.product_models) ? base?.product_models[0] : base?.product_models;
    if (m?.name) modelNameByKey.set(l.key, m.name);
  }
  return result;
};

/** Marshal one POS CartLine into the SO items payload. itemCode is the
 *  size-specific mfg_products.code resolved by fetchItemCodeMap (passed in as
 *  `resolvedItemCode`); falls back to the legacy catalog sku, then the raw
 *  productId, so a partial catalog never blocks confirm. itemGroup = category.
 *  unitPriceCenti = config.total (whole MYR) × 100 — POS stores whole ringgit,
 *  the Backend SO ledger is sen. */
export const cartLineToSoItem = (
  line: CartLine,
  productById: Map<string, CatalogProduct>,
  resolvedItemCode?: string,
  resolvedModelName?: string,
): PosHandoffItem => {
  const product = productById.get(line.config.productId);
  // Fallback to the line's productId if neither the resolver nor the catalog
  // produced a code — the coordinator's SO detail surface uses item_code as the
  // human ref, so a missing SKU is preferable to a blocking failure at confirm.
  const itemCode = resolvedItemCode ?? product?.sku ?? line.config.productId;
  const itemGroup = inferItemGroup(line.config, product);
  // 0170 — Default Free Gift marker. The server re-derives eligibility from the
  // order's real trigger lines; triggerRef/triggerKind here are informational.
  const cfg = line.config as {
    isFreeGift?: boolean; freeGiftCampaign?: string | null; freeGiftTriggerKey?: string; productId: string;
  };
  const freeGift = cfg.isFreeGift
    ? { freeGift: { triggerRef: cfg.freeGiftTriggerKey ?? '', triggerKind: 'product' as const, campaignName: cfg.freeGiftCampaign ?? null, giftProductId: cfg.productId } }
    : null;
  // Whole-MYR → sen. POS uses INTEGER ringgit (db/schema.ts §Money), the
  // Backend SO ledger is sen — multiply at the boundary.
  const unitPriceCenti = Math.round(line.config.total * 100);
  // Sales Order line description (Chairman 2026-06-03): a sofa lists the Model
  // name followed by every compartment code of the build, left-to-right —
  // "Lyyar · 1A(LHF) + 1NA + 2A(RHF)". Other categories keep the Model/product
  // name. A bundle-only sofa (no cells) falls back to the Model name.
  // `resolvedModelName` (product_models.name via fetchItemCodeMap) is the
  // clean Model name; without it a sofa line fell back to its snapshot
  // productName — the lead per-module SKU name ("SOFA ANNSA 1A(LHF)").
  const fallbackName = product?.name ?? line.config.productName ?? itemCode;
  let description = fallbackName;
  if (line.config.kind === 'sofa') {
    const modelName = resolvedModelName ?? fallbackName;
    description = modelName;
    if (line.config.cells && line.config.cells.length > 0) {
      // Left-to-right WALK (Loo 2026-06-12) — chaise wing first, then the
      // corner, then across to the right arm; same order the server's P3
      // split persists the per-module lines in.
      const codes = orderSofaCellsLeftToRight(line.config.cells, line.config.depth ?? '24')
        .map((c) => c.moduleId)
        .filter(Boolean);
      if (codes.length > 0) description = `${modelName} · ${codes.join(' + ')}`;
    }
  }
  return {
    itemCode,
    itemGroup,
    description,
    qty: line.qty,
    unitPriceCenti,
    discountCenti: 0,
    variants: freeGift ? { ...(buildVariants(line.config) ?? {}), ...freeGift } : buildVariants(line.config),
    cartLineKey: line.key,
  };
};

/** Marshal the full cart into the items array. Empty cart returns []. Pass
 *  `resolution` (from fetchItemCodeMap) so each line books its real mfg code
 *  + the clean Model name for the sofa description; omit it only in tests
 *  that exercise the legacy catalog-sku fallback. */
export const cartLinesToSoItems = (
  lines: CartLine[],
  products: CatalogProduct[] | undefined,
  resolution?: SoLineResolution,
): PosHandoffItem[] => {
  const productById = new Map<string, CatalogProduct>(
    (products ?? []).map((p) => [p.id, p]),
  );
  return lines.map((l) =>
    cartLineToSoItem(l, productById, resolution?.codeByKey.get(l.key), resolution?.modelNameByKey.get(l.key)),
  );
};

/* ─── Mutation ───────────────────────────────────────────────────────── */

const submitHandoff = async (payload: PosHandoffPayload): Promise<SoCreatedResponse> => {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');

  const res = await fetch(`${API_URL}/mfg-sales-orders`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let body: PosHandoffError = { error: `http_${res.status}` };
    try {
      body = (await res.json()) as PosHandoffError;
    } catch {
      // body wasn't JSON — keep the http_NNN error code. The thrown message
      // will at least surface the status to the user.
    }
    throw new PosHandoffApiError(res.status, body);
  }
  return (await res.json()) as SoCreatedResponse;
};

/** Mutation hook — POST the full POS handover payload to /mfg-sales-orders and
 *  return the new SO docNo on success. The caller (Handover.tsx) handles
 *  navigation to the thank-you screen; this hook just owns the network call
 *  + auth. */
export const usePosHandoffToSo = () =>
  useMutation<SoCreatedResponse, Error, PosHandoffPayload>({
    mutationFn: submitHandoff,
  });
