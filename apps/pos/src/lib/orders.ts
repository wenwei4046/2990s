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
  paymentMethod: OrderV1PostBody['paymentMethod'];
  approvalCode?: string;
  notes?: string;
  lines: CartLine[];
  /** When true, override the drift check by sending the server's total back. */
  acceptedServerTotal?: number;
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
        },
      };
    }
    return {
      qty: l.qty,
      config: {
        kind: 'size' as const,
        productId: l.config.productId,
        sizeId: l.config.sizeId,
      },
    };
  });

  const clientTotal = input.acceptedServerTotal
    ?? input.lines.reduce((s, l) => s + l.qty * l.config.total, 0);

  return {
    customer: input.customer,
    paymentMethod: input.paymentMethod,
    ...(input.approvalCode ? { approvalCode: input.approvalCode } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    lines,
    clientTotal,
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
    let payload: PricingDriftPayload;
    try {
      payload = (await res.json()) as PricingDriftPayload;
    } catch {
      throw new Error('POST /orders returned 409 with malformed body');
    }
    throw new PricingDriftError(payload);
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
