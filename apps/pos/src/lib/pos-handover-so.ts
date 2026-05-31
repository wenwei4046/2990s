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
//   targetDate, customerDeliveryDate, paymentMethod, items: [...]
//
// On success the server returns { docNo: 'SO-NNNNNN' } and the caller
// navigates to the handover thank-you screen with that docNo. On failure the
// API returns { error, reason } which we surface verbatim — the Handover page
// renders it under the StepFooter.
//
// Mirrors the pattern in apps/backend/src/lib/flow-queries.ts:
// `useCreateMfgSalesOrder` (camelCase POST + 201 → { docNo }).

import { useMutation } from '@tanstack/react-query';
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
  customerType?: 'new' | 'existing';
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
  buildingType?: 'condo' | 'landed' | 'apartment' | 'office' | 'shop' | 'other';

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

  /* Payment. */
  paymentMethod?: 'merchant' | 'transfer' | 'installment' | 'cash';
  installmentMonths?: 6 | 12;
  merchantProvider?: 'GHL' | 'HLB' | 'MBB' | 'PBB';
  approvalCode?: string;
  /** Deposit / amount collected at handover in centi-MYR (sen). */
  depositCenti?: number;

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
}

export interface PosHandoffError {
  /** Machine-readable error string from the API (e.g. 'customer_name_required',
   *  'insert_failed', 'items_insert_failed'). */
  error: string;
  /** Optional underlying reason — usually a Postgres / Supabase error message. */
  reason?: string;
}

export class PosHandoffApiError extends Error {
  payload: PosHandoffError;
  status: number;
  constructor(status: number, payload: PosHandoffError) {
    super(payload.reason ?? payload.error ?? `POST /mfg-sales-orders failed (${status})`);
    this.status = status;
    this.payload = payload;
  }
}

/* ─── Item marshalling ──────────────────────────────────────────────── */

/** Map a POS cart line's CartConfig.kind → SO item_group. The Backend's
 *  SoLineCard / SalesOrderDetail switches on this string to decide which
 *  variants grid to render (sofa vs bedframe vs mattress). For mattress
 *  size-variants and flat-priced products we read the product's category
 *  off the catalog row — kind === 'size' covers both mattresses and
 *  size-priced sofas/bedframes, so the category lookup is required to
 *  disambiguate. Defaults to 'others' if we can't classify confidently. */
const inferItemGroup = (
  config: CartConfig,
  product: CatalogProduct | undefined,
): PosHandoffItem['itemGroup'] => {
  if (config.kind === 'sofa') return 'sofa';
  if (config.kind === 'bedframe') return 'bedframe';
  const categoryId = product?.category?.id?.toLowerCase() ?? '';
  if (categoryId.includes('mattress')) return 'mattress';
  if (categoryId.includes('sofa')) return 'sofa';
  if (categoryId.includes('bedframe')) return 'bedframe';
  if (categoryId.includes('accessor') || categoryId.includes('addon')) return 'accessory';
  return 'others';
};

/** Build the `variants` JSON column for one cart line. The shape matches what
 *  apps/backend SoLineCard expects per category:
 *    sofa:     { bundleId?, cells?, depth?, fabricId?, fabricLabel?,
 *                colourId?, colourLabel?, seatUpgradeLabel?, seatUpgradeFootrest? }
 *    bedframe: { sizeId, sizeOther?, colourId, colourLabel?, gap?, gapLabel?,
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
    if (config.summary)         v.summary = config.summary;
    return Object.keys(v).length > 0 ? v : null;
  }
  if (config.kind === 'bedframe') {
    const v: Record<string, unknown> = {
      sizeId: config.sizeId,
      colourId: config.colourId,
    };
    if (config.sizeOther)             v.sizeOther = config.sizeOther;
    if (config.colourLabel != null)   v.colourLabel = config.colourLabel;
    if (config.colourHex)              v.colourHex = config.colourHex;
    if (config.gapId)                 v.gap = config.gapId;
    if (config.gapLabel != null)      v.gapLabel = config.gapLabel;
    if (config.legHeightId)           v.legHeight = config.legHeightId;
    if (config.legHeightLabel != null) v.legHeightLabel = config.legHeightLabel;
    if (config.divanHeightId)         v.divanHeight = config.divanHeightId;
    if (config.divanHeightLabel != null) v.divanHeightLabel = config.divanHeightLabel;
    if (config.totalHeightId)         v.totalHeight = config.totalHeightId;
    if (config.totalHeightLabel != null) v.totalHeightLabel = config.totalHeightLabel;
    if (config.specialIds && config.specialIds.length > 0) v.specialIds = config.specialIds;
    if (config.specialLabels && config.specialLabels.length > 0) v.specialLabels = config.specialLabels;
    if (config.summary)               v.summary = config.summary;
    return v;
  }
  if (config.kind === 'size') {
    const v: Record<string, unknown> = { sizeId: config.sizeId };
    if (config.addonExtras && config.addonExtras.length > 0) v.addonExtras = config.addonExtras;
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

/** Build a {cartLineKey → mfg_products.code} map for a cart. Two reads:
 *  (1) the cart's mfg rows by id, (2) their Models' sibling SKUs (only when a
 *  size-variant line needs the size-specific code). The legacy `products`
 *  catalog is empty in production, so this — not product.sku — is the real
 *  itemCode source the SO handover depends on. */
export const fetchItemCodeMap = async (lines: CartLine[]): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  const productIds = [...new Set(lines.map((l) => l.config.productId).filter(Boolean))];
  if (productIds.length === 0) return result;

  const { data: baseData } = await supabase
    .from('mfg_products')
    .select('id, code, model_id, category, size_code')
    .in('id', productIds);
  const byId = new Map<string, MfgCodeRow>(((baseData ?? []) as MfgCodeRow[]).map((r) => [r.id, r]));

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
    if (code) result.set(l.key, code);
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
): PosHandoffItem => {
  const product = productById.get(line.config.productId);
  // Fallback to the line's productId if neither the resolver nor the catalog
  // produced a code — the coordinator's SO detail surface uses item_code as the
  // human ref, so a missing SKU is preferable to a blocking failure at confirm.
  const itemCode = resolvedItemCode ?? product?.sku ?? line.config.productId;
  const itemGroup = inferItemGroup(line.config, product);
  // Whole-MYR → sen. POS uses INTEGER ringgit (db/schema.ts §Money), the
  // Backend SO ledger is sen — multiply at the boundary.
  const unitPriceCenti = Math.round(line.config.total * 100);
  return {
    itemCode,
    itemGroup,
    description: product?.name ?? line.config.productName ?? itemCode,
    qty: line.qty,
    unitPriceCenti,
    discountCenti: 0,
    variants: buildVariants(line.config),
  };
};

/** Marshal the full cart into the items array. Empty cart returns []. Pass
 *  `codeByKey` (from fetchItemCodeMap) so each line books its real mfg code;
 *  omit it only in tests that exercise the legacy catalog-sku fallback. */
export const cartLinesToSoItems = (
  lines: CartLine[],
  products: CatalogProduct[] | undefined,
  codeByKey?: Map<string, string>,
): PosHandoffItem[] => {
  const productById = new Map<string, CatalogProduct>(
    (products ?? []).map((p) => [p.id, p]),
  );
  return lines.map((l) => cartLineToSoItem(l, productById, codeByKey?.get(l.key)));
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
