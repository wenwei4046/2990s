import { supabase } from './supabase';
import type { PurchaseOrder } from './queries';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

export interface CreatePoInput {
  supplierId: string;
  lineItems: {
    orderId: string;
    sku: string;
    name: string;
    size: string | null;
    colour: string | null;
    qty: number;
  }[];
}

export async function createPO(input: CreatePoInput): Promise<PurchaseOrder> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const body = {
    supplier_id: input.supplierId,
    line_items: input.lineItems.map((it) => ({
      order_id: it.orderId,
      sku: it.sku,
      name: it.name,
      size: it.size,
      colour: it.colour,
      qty: it.qty,
    })),
  };
  const res = await fetch(`${API_URL}/purchase-orders`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`createPO failed (${res.status}): ${text}`);
  }
  const json: any = await res.json();
  return {
    id: json.id,
    poNumber: json.po_number,
    supplier: {
      id: json.supplier.id,
      code: json.supplier.code,
      name: json.supplier.name,
      whatsappNumber: json.supplier.whatsapp_number,
      email: json.supplier.email,
    },
    createdAt: json.created_at,
    createdBy: { id: json.created_by.id, name: json.created_by.name },
    lines: (json.lines ?? []).map((l: any) => ({
      id: l.id,
      purchaseOrderId: l.purchase_order_id,
      orderId: l.order_id,
      sku: l.sku,
      name: l.name,
      size: l.size,
      colour: l.colour,
      qty: l.qty,
    })),
    referencedOrderIds: json.referenced_order_ids ?? [],
  };
}

/** URL of the printable HTML view. Caller passes this to window.open. */
export function getPrintUrl(poId: string): string {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  return `${API_URL}/purchase-orders/${encodeURIComponent(poId)}/print`;
}

/** Open the print view in a new tab. Returns the WindowProxy or null if blocked by popup blocker. */
export function openPrintWindow(poId: string): Window | null {
  return window.open(getPrintUrl(poId), '_blank');
}

/** Build a wa.me share URL with a pre-filled greeting. Coordinator manually attaches the PDF. */
export function buildWhatsAppShareUrl(supplierName: string, whatsappNumber: string, poNumber: string): string {
  const cleanedNumber = whatsappNumber.replace(/[^\d]/g, '');
  const text = encodeURIComponent(
    `Hi ${supplierName}, here is our purchase order ${poNumber}. Please confirm receipt and expected delivery. Thanks — 2990's`
  );
  return `https://wa.me/${cleanedNumber}?text=${text}`;
}

/** Build a mailto: link with pre-filled subject + body. */
export function buildMailtoUrl(email: string, supplierName: string, poNumber: string): string {
  const subject = encodeURIComponent(`Purchase Order ${poNumber} from 2990's`);
  const body = encodeURIComponent(
    `Hi ${supplierName},\n\nPlease find our purchase order ${poNumber} attached. Please confirm receipt and expected delivery date.\n\nThanks,\n2990's`
  );
  return `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}
