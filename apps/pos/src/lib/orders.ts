import { useMutation } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { CartLine } from '../state/cart';
import type { OrderV1PostBody } from '@2990s/shared/schemas';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

/* ─── Types matching apps/api/src/routes/orders.ts shapes ──────────── */

export interface OrderCreatedResponse {
  id: string;
  subtotal: number;
  total: number;
  lines: { productId: string; qty: number; unitPrice: number; lineTotal: number; kind: string }[];
}

export interface PricingDriftPayload {
  error: 'pricing_drift';
  clientTotal: number;
  serverTotal: number;
  lines: {
    qty: number;
    productId: string;
    unitPrice: number;
    lineTotal: number;
    breakdown: string[];
    clientConfig: unknown;
  }[];
}

export class PricingDriftError extends Error {
  payload: PricingDriftPayload;
  constructor(payload: PricingDriftPayload) {
    super('pricing drift');
    this.payload = payload;
  }
}

export interface OrderSubmitInput {
  customer: OrderV1PostBody['customer'];
  paymentMethod: NonNullable<OrderV1PostBody['paymentMethod']>;
  approvalCode?: string;
  notes?: string;
  /** ISO YYYY-MM-DD; omit for "delivery TBD". */
  deliveryDate?: string;
  lines: CartLine[];
  /** When true, override the drift check by sending the server's total back. */
  acceptedServerTotal?: number;
  /** Slip MVP: required when paymentMethod='transfer'. */
  uploadSessionId?: string;

  // Handover-redesign (Phase 4.5) ─────────────────────────────────────
  customerType?: 'new' | 'existing';
  buildingType?: 'condo' | 'landed' | 'apartment' | 'office' | 'shop' | 'other';
  billingSame?: boolean;
  salespersonId?: string;
  specialInstructions?: string;
  addressLater?: boolean;
  addons?: { addonId: string; qty?: number; floorsCount?: number; itemsCount?: number }[];
  /** Total of handover addons computed client-side via shared addonPrice().
   *  Sums into clientTotal so the server-side pricing drift check matches —
   *  otherwise every order with selected addons fires a spurious 409. */
  addonTotal?: number;
  /** Amount actually collected at handover (MYR integer). Threaded to the
   *  RPC's `paid` field; the Confirmed page surfaces this as "PAID RM X". */
  paid?: number;
  /** Installment term (6 or 12 months); only set when paymentMethod==='installment'. */
  installmentMonths?: 6 | 12 | null;
  /** Merchant acquirer / terminal; only set when paymentMethod==='merchant'. */
  merchantProvider?: 'GHL' | 'HLB' | 'MBB' | 'PBB' | null;
  /** Additional delivery fee keyed in by POS sales at handover (MYR integer).
   *  Forwarded to POST /orders; server adds it to baseFee + crossCategoryFee
   *  to compute the canonical delivery total. (Migration 0029) */
  additionalDeliveryFee?: number;
  /** Full client-computed delivery fee total (base + cross-category + additional).
   *  Summed into clientTotal so the 0.5% drift check matches the server's
   *  recompute. Without this an order with a RM 250 base fee fires a 409. */
  deliveryFeeTotal?: number;
  /** Customer e-signature captured by Handover SignaturePad — base64 PNG data
   *  URL. Persisted to orders.signature_data; re-rendered 1:1 on the printed
   *  Sales Order. Optional so older POS clients still parse. */
  signatureData?: string;
}

const buildPostBody = (input: OrderSubmitInput): OrderV1PostBody => {
  // Translate POS CartLine[] → POST /orders shape. The unit total per line
  // (config.total) is what we display; clientTotal aggregates qty × total.
  const lines = input.lines.map((l) => {
    if (l.config.kind === 'sofa') {
      return {
        qty: l.qty,
        config: {
          kind: 'sofa' as const,
          productId: l.config.productId,
          ...(l.config.bundleId ? { bundleId: l.config.bundleId } : {}),
          ...(l.config.cells ? { cells: l.config.cells } : {}),
          ...(l.config.depth ? { depth: l.config.depth } : {}),
          ...(l.config.seatUpgradeLabel ? { seatUpgradeLabel: l.config.seatUpgradeLabel } : {}),
          ...(l.config.seatUpgradeFootrest !== undefined ? { seatUpgradeFootrest: l.config.seatUpgradeFootrest } : {}),
          ...(l.config.fabricId ? { fabricId: l.config.fabricId } : {}),
          ...(l.config.colourId ? { colourId: l.config.colourId } : {}),
          ...(l.config.fabricLabel ? { fabricLabel: l.config.fabricLabel } : {}),
          ...(l.config.colourLabel ? { colourLabel: l.config.colourLabel } : {}),
        },
      };
    }
    if (l.config.kind === 'size') {
      return {
        qty: l.qty,
        config: {
          kind: 'size' as const,
          productId: l.config.productId,
          sizeId: l.config.sizeId,
          ...(l.config.addonExtras && l.config.addonExtras.length > 0
            ? { addonExtras: l.config.addonExtras }
            : {}),
        },
      };
    }
    // flat
    return {
      qty: l.qty,
      config: {
        kind: 'flat' as const,
        productId: l.config.productId,
      },
    };
  });

  // clientTotal must include handover addons + delivery fee so the server's
  // drift check (subtotal + addonTotal + deliveryFee) matches what we sent.
  // acceptedServerTotal short-circuits this on the retry path after the user
  // accepts a 409 drift.
  const clientTotal = input.acceptedServerTotal
    ?? (input.lines.reduce((s, l) => s + l.qty * l.config.total, 0)
        + (input.addonTotal ?? 0)
        + (input.deliveryFeeTotal ?? 0));

  return {
    customer: input.customer,
    paymentMethod: input.paymentMethod,
    ...(input.approvalCode ? { approvalCode: input.approvalCode } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.deliveryDate ? { deliveryDate: input.deliveryDate } : {}),
    ...(input.customerType ? { customerType: input.customerType } : {}),
    ...(input.buildingType ? { buildingType: input.buildingType } : {}),
    ...(input.billingSame !== undefined ? { billingSame: input.billingSame } : {}),
    ...(input.salespersonId ? { salespersonId: input.salespersonId } : {}),
    ...(input.specialInstructions ? { specialInstructions: input.specialInstructions } : {}),
    ...(input.addressLater !== undefined ? { addressLater: input.addressLater } : {}),
    ...(input.addons && input.addons.length > 0 ? { addons: input.addons } : {}),
    ...(input.paid !== undefined ? { paid: input.paid } : {}),
    ...(input.installmentMonths != null ? { installmentMonths: input.installmentMonths } : {}),
    ...(input.merchantProvider != null ? { merchantProvider: input.merchantProvider } : {}),
    ...(input.additionalDeliveryFee !== undefined
      ? { additionalDeliveryFee: input.additionalDeliveryFee }
      : {}),
    lines,
    clientTotal,
    ...(input.uploadSessionId ? { uploadSessionId: input.uploadSessionId } : {}),
    ...(input.signatureData ? { signatureData: input.signatureData } : {}),
  };
};

const submitOrder = async (input: OrderSubmitInput): Promise<OrderCreatedResponse> => {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (!token) throw new Error('not_authenticated');

  const body = buildPostBody(input);
  const res = await fetch(`${API_URL}/orders`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    let payload: { error?: string } & Partial<PricingDriftPayload>;
    try {
      payload = await res.json() as typeof payload;
    } catch {
      throw new Error('POST /orders returned 409 with malformed body');
    }
    // 409 is shared between pricing_drift and slip state conflicts
    // (slip_not_ready). Only pricing_drift carries the totals payload.
    if (payload.error === 'pricing_drift' && payload.clientTotal !== undefined) {
      throw new PricingDriftError(payload as PricingDriftPayload);
    }
    throw new Error(`POST /orders failed (409): ${JSON.stringify(payload)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`POST /orders failed (${res.status}): ${text}`);
  }
  return (await res.json()) as OrderCreatedResponse;
};

export const useCreateOrder = () =>
  useMutation<OrderCreatedResponse, Error, OrderSubmitInput>({
    mutationFn: submitOrder,
  });
