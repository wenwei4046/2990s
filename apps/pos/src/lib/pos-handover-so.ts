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

import { useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { orderSofaCellsLeftToRight } from '@2990s/shared/sofa-build';
import { deliveryTargetMatchesAnyLine, parseRuleTargets, type RuleLineInput } from '@2990s/shared';
import { authedFetch, authedFetchRaw } from './apiClient';
import { sizeIdToMfgCode } from './queries';
import type { CartLine, CartConfig } from '../state/cart';
import type { CatalogProduct, SpecialDeliveryFeeRow } from './queries';
import type { SpecialModelDeliveryFee } from '@2990s/shared/pricing';

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

  /* Marketing demographics (camelCase). The API persists these to the customers
     table — race / birthday / gender — via upsert_customer_by_name_phone, NOT on
     the SO. Optional on the wire — the POS form enforces required-for-new before
     submit; never shown on the SO/PDF. */
  customerRace?: string;
  customerBirthday?: string; // ISO YYYY-MM-DD
  customerGender?: string;

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
    /** Spec D4 — each split payment's own slip upload session. Omitted for cash
     *  legs, which carry no slip (Loo 2026-06-18); the server requires it for
     *  every non-cash row. */
    uploadSessionId?: string;
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
  /** validation_failed detail (Houzs so-save-problems.ts) — server aggregates
   *  every failing check into one array so the caller can render them all at
   *  once instead of fix-one-then-hit-the-next. */
  problems?: Array<{
    code: string;
    message?: string;
    line?: string;
    field?: string;
    facts?: Record<string, unknown>;
  }>;
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
  /* validation_failed (Houzs aggregated 422) — unpack the problems array so the
     salesperson sees each per-line/per-field issue at once rather than "N things
     need fixing". */
  if (payload.error === 'validation_failed' && Array.isArray(payload.problems) && payload.problems.length > 0) {
    const lines = payload.problems.map((p) => {
      const where = p.line ? `${p.line}: ` : '';
      const label = p.field ? ` (${p.field})` : '';
      return `${where}${p.message ?? p.code}${label}`;
    });
    return `Order placement failed: ${payload.message ?? 'validation_failed'} — ${lines.join('; ')}`;
  }

  /* Owner-rule 409s that reach the handover surface — matched to Houzs's server
     error codes so the salesperson sees the same copy the drawer shows. */
  if (payload.error === 'so_locked_processing') {
    return 'The processing date has passed — items and dates are locked. Customer, address and payment can still be updated.';
  }
  if (payload.error === 'processing_date_remove_forbidden') {
    return 'Only an admin can clear a Processing Date once it is set. Ask a coordinator or owner.';
  }
  if (payload.error === 'so_identity_locked') {
    return 'This order already has a delivery or invoice — the customer identity can no longer be changed.';
  }
  if (payload.error === 'free_and_pwp_exclusive') {
    return 'A Free Item and a PWP reward can\'t be applied to the same line. Remove one before saving.';
  }
  if (payload.error === 'free_item_not_eligible') {
    return 'This free item isn\'t eligible for the campaign selected. Pick a different item or campaign.';
  }
  if (payload.error === 'state_change_conflicts_line_warehouse') {
    return 'The new State would move a line to a different warehouse, but a PO / DO is already cut against the old one. Cancel the affected downstream doc (or move each line explicitly) before changing the State.';
  }

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

/** True when a cart line has been made free by a Free Item Campaign. cart.makeFree
 *  stamps `config.freeItemCampaignId` (and forces total:0); this flat marker is
 *  only rewritten to `variants.freeItem` at submit (buildVariants below), so the
 *  pre-submit delivery preview must test the config field — NOT the shared
 *  isFreeItemLine(variants), which would silently never match here. */
export const isFreeItemConfig = (config: CartConfig): boolean =>
  Boolean((config as { freeItemCampaignId?: string | null }).freeItemCampaignId);

const DELIVERABLE_GROUPS = new Set(['sofa', 'mattress', 'bedframe']);

/** One mfg-catalog row, narrowed to what the delivery-fee rule matcher needs.
 *  The Handover passes `useMfgCatalogIndex()` (Map<sku id, MfgCatalogRow>) here —
 *  the same index CartContents uses for Free Item eligibility — so the line's
 *  Model + category resolve even for size-variant SKUs the legacy catalog misses. */
interface DeliveryRuleMfgRow {
  category?: string | null;
  modelId?: string | null;
}

/** Flatten one cart line to the shared RuleLineInput the special-delivery matcher
 *  expects. Mirrors the server's RuleLineInput construction in
 *  POST /mfg-sales-orders so client preview + server recompute match exactly:
 *    - category / modelId from the mfg catalog row (not the legacy catalog),
 *    - sizeCode from the configured size id (mattress / bedframe variant rules),
 *    - builtCompartments from the sofa build cells (combo / compartment rules). */
const cartLineToRuleInput = (
  config: CartConfig,
  mfgRow: DeliveryRuleMfgRow | undefined,
): RuleLineInput => {
  const cfg = config as {
    sizeId?: string | null;
    cells?: Array<{ moduleId?: unknown }>;
  };
  // Model comes from the mfg catalog row ONLY — mirrors CartContents.tsx (the
  // canonical Free Item construction) and the server create-path
  // (mfg-sales-orders.ts uses product.model_id). Preferring config.modelId here
  // would let the POS preview resolve a different Model than the server recompute
  // for the same SKU id — an honest-pricing drift seam the server doesn't share.
  const modelId = mfgRow?.modelId ?? null;
  const builtCompartments = Array.isArray(cfg.cells)
    ? cfg.cells.map((c) => String(c?.moduleId ?? '')).filter(Boolean)
    : [];
  return {
    category: String(mfgRow?.category ?? ''),
    modelId,
    sizeCode: sizeIdToMfgCode(cfg.sizeId),
    builtCompartments,
  };
};

/** Build computeSoDeliveryFee's `categoryIds` + `specialModels` inputs from POS
 *  cart lines, EXCLUDING free-item-campaign lines — a giveaway carries no
 *  delivery charge. Mirrors the server's freeItemByIdx exclusion in
 *  POST /mfg-sales-orders (commit 6071d647) so the POS preview equals the fee the
 *  server actually persists (no customer-facing mismatch). A makeFree split keeps
 *  its paid remainder deliverable — only the free line drops out.
 *
 *  Special fees are matched via the #691 RuleTarget abstraction (migration 0182):
 *  each special-delivery rule's `target` (model / variant / compartment / combo)
 *  is run against the cart's RuleLineInput[] with the SAME shared
 *  `deliveryTargetMatchesAnyLine` the server uses — every matching rule contributes
 *  one special fee entry. Fees stay whole-MYR here (the entire POS preview pipeline
 *  is whole-MYR: subtotal + base + delivery all in RM); the server works in sen. */
export const buildDeliveryFeeCartInputs = (
  lines: CartLine[],
  productById: Map<string, CatalogProduct>,
  mfgById: Map<string, DeliveryRuleMfgRow>,
  rules: SpecialDeliveryFeeRow[],
  comboModulesById: Map<string, string[][]>,
): { categoryIds: string[]; specialModels: SpecialModelDeliveryFee[] } => {
  const payable = lines.filter((l) => !isFreeItemConfig(l.config));
  const categoryIds = payable
    .map((l) => inferItemGroup(l.config, productById.get(l.config.productId)))
    .filter((g) => DELIVERABLE_GROUPS.has(g));
  // Flatten payable lines to RuleLineInput[] (free-item lines already dropped —
  // a giveaway carries no special transport fee, mirroring the server).
  const ruleLines = payable.map((l) => cartLineToRuleInput(l.config, mfgById.get(l.config.productId)));
  const specialModels = rules
    .filter((r) => deliveryTargetMatchesAnyLine(ruleLines, parseRuleTargets(r.target), comboModulesById))
    .map((r) => ({ standaloneFee: r.standaloneFee, crossCategoryFollowupFee: r.crossCatFollowupFee }));
  return { categoryIds, specialModels };
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

  // (P4.3) Houzs seam: the two direct `supabase.from('mfg_products')` reads this
  // used are replaced by GET /pos-pools/mfg-catalog — the SAME endpoint queries.ts
  // uses to replace every direct mfg_products read. It has no bulk-`id` param, so
  // fan out over the cart's distinct ids (by-id returns one SKU, any status /
  // pos_active, with its Model embed); siblings come from the ?modelId scope
  // (no status/pos_active filter, exactly like the old unfiltered read).
  type BaseRow = MfgCodeRow & {
    // FK embed comes back object or array depending on the cached schema
    // cardinality (same defensive coercion as useMfgCatalog).
    product_models: { name: string } | Array<{ name: string }> | null;
  };
  const fetchById = async (id: string): Promise<BaseRow | null> => {
    const { products } = await authedFetch<{ products: BaseRow[] }>(
      `/pos-pools/mfg-catalog?id=${encodeURIComponent(id)}`,
    );
    return (products ?? [])[0] ?? null;
  };
  const baseRows = (await Promise.all(productIds.map(fetchById)))
    .filter((r): r is BaseRow => r !== null);
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
    const perModel = await Promise.all(modelIds.map(async (modelId) => {
      const { products } = await authedFetch<{
        products: Array<{ code: string; size_code: string | null }>;
      }>(`/pos-pools/mfg-catalog?modelId=${encodeURIComponent(modelId)}`);
      return [modelId, (products ?? []).map((s) => ({ code: s.code, size_code: s.size_code }))] as const;
    }));
    for (const [modelId, sibs] of perModel) sibsByModel.set(modelId, sibs);
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
  // 0176 — Free Item Campaign marker. campaignName is resolved server-side; we
  // send only the campaignId (the server re-validates eligibility + cap).
  const fic = (line.config as { freeItemCampaignId?: string | null });
  const freeItem = fic.freeItemCampaignId
    ? { freeItem: { campaignId: fic.freeItemCampaignId } }
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
    variants: (freeGift || freeItem)
      ? { ...(buildVariants(line.config) ?? {}), ...freeGift, ...freeItem }
      : buildVariants(line.config),
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

const submitHandoff = async (payload: PosHandoffPayload, idempotencyKey?: string): Promise<SoCreatedResponse> => {
  const res = await authedFetchRaw('/mfg-sales-orders', {
    method: 'POST',
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
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
export const usePosHandoffToSo = () => {
  // Stable idempotency key per order INTENT — reused across a double-click or a
  // retry of the SAME submit so Houzs's /api/* idempotency middleware replays
  // the first response instead of minting a duplicate SO (the motivating case:
  // a cold-Hyperdrive 503 then a re-submit). Reset on success so the next order
  // gets a fresh key. The 2990 target has no such middleware and ignores the
  // header harmlessly.
  const keyRef = useRef<string | null>(null);
  return useMutation<SoCreatedResponse, Error, PosHandoffPayload>({
    mutationFn: (payload) => {
      keyRef.current ??= crypto.randomUUID();
      return submitHandoff(payload, keyRef.current);
    },
    onSuccess: () => {
      keyRef.current = null;
    },
  });
};
