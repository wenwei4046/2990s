import { useQuery } from '@tanstack/react-query';
import {
  groupSoLinesForDisplay,
  pwpRewardNote,
  pwpTriggerNotes,
  type SoPwpCodeRow,
  type SoPwpNote,
} from '@2990s/shared/so-line-display';
import { supabase } from './supabase';
import { COMPANY_LEGAL } from './legal';

// Customer-facing Sales Order, sourced from the LIVE order model
// (`mfg_sales_orders` via GET /mfg-sales-orders/:docNo). The legacy retail
// `orders` table is dead for POS, so the old orders-by-id reader can't render
// a real SO — this hook replaces it for the printable view.
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface PrintableLine {
  sku: string;
  description: string;
  /** Muted second line — folded sofa composition + shared variant summary. */
  sub: string | null;
  /** PWP voucher notes (used = accent, unused = muted — 排法 A). */
  notes: SoPwpNote[];
  qty: number;
  unitPrice: number; // MYR
  lineTotal: number; // MYR
}

export interface PrintableSO {
  id: string;
  date: string | null;
  deliveryDate: string | null;
  paymentMethod: string | null;
  customerName: string;
  customerAddressLines: string[];
  customerPhone: string | null;
  soldByName: string;
  soldByAddressLines: string[];
  subtotal: number; // MYR
  paid: number;
  total: number;
  balance: number;
  signature: string | null; // data URL, ready for <img src>
  lines: PrintableLine[];
}

// mfg money columns are in centi (1/100 MYR), same as GET /mfg-sales-orders/mine.
const centiToMyr = (c: number | null | undefined): number => (c ?? 0) / 100;

// Split a one-string address at the 5-digit Malaysian postcode into 2 lines
// (street, then "postcode city state") rather than at every comma.
function splitMyAddress(addr: string): string[] {
  const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
  const pcIdx = parts.findIndex((p) => /^\d{5}\b/.test(p));
  return pcIdx > 0
    ? [parts.slice(0, pcIdx).join(', '), parts.slice(pcIdx).join(', ')]
    : [addr];
}

export const useSalesOrderDoc = (docNo: string | undefined) =>
  useQuery({
    enabled: !!docNo,
    queryKey: ['so-doc-print', docNo],
    queryFn: async (): Promise<PrintableSO> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      if (!docNo) throw new Error('no doc');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');

      const res = await fetch(`${API_URL}/mfg-sales-orders/${encodeURIComponent(docNo)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /mfg-sales-orders/${docNo} failed (${res.status})`);
      const body = (await res.json()) as {
        salesOrder: Record<string, any>;
        items: Record<string, any>[];
        pwpCodes?: SoPwpCodeRow[];
      };
      const so = body.salesOrder ?? {};
      const items = body.items ?? [];
      const pwpCodes = body.pwpCodes ?? [];

      // Bill-to address: address1..4 then "postcode city state". Skip blanks.
      const tail = [so.postcode, so.city, so.customer_state].filter(Boolean).join(' ');
      const customerAddressLines = [so.address1, so.address2, so.address3, so.address4, tail]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);

      // Sold by: the showroom venue name + its street address (single showroom
      // at MVP — "PJ Showroom" per Loo). When a 2nd showroom opens this becomes
      // a per-SO lookup; for now both come from legal.ts.
      const soldByName = COMPANY_LEGAL.showroomName;

      const total = centiToMyr(so.total_revenue_centi);
      const paid = centiToMyr(so.paid_centi ?? so.deposit_centi);
      const balance = so.balance_centi != null ? centiToMyr(so.balance_centi) : Math.max(0, total - paid);

      const rawSig = typeof so.signature_b64 === 'string' ? so.signature_b64 : '';
      const signature = rawSig
        ? (rawSig.startsWith('data:') ? rawSig : `data:image/png;base64,${rawSig}`)
        : null;

      /* Loo 2026-06-05 — customer-facing fold: per-module sofa SKU lines
         (variants.buildKey groups from the P3 split) render as ONE Model row
         with the combined price; the persisted lines and the Backend grids
         stay per-SKU. PWP notes ride under the description: a reward line
         shows the voucher it consumed, a trigger line shows codes this SO
         issued (USED → short reference; unused → "not redeemed yet" 排法 A). */
      const groups = groupSoLinesForDisplay(
        items.filter((it) => !it.cancelled) as Array<Record<string, any> & { item_code: string }>,
      );
      const lines: PrintableLine[] = groups.map((g) => {
        const lead = g.lines[0]!;
        const notes: SoPwpNote[] = [
          pwpRewardNote(lead.variants),
          ...pwpTriggerNotes(g.lines.map((l) => l.item_code as string), pwpCodes),
        ].filter((n): n is SoPwpNote => n != null);
        if (g.kind === 'sofa-build' && g.display) {
          const d = g.display;
          return {
            sku: d.itemCode,
            description: d.description,
            sub: [d.composition, d.description2].filter(Boolean).join(' · ') || null,
            notes,
            qty: d.qty,
            unitPrice: centiToMyr(d.unitPriceCenti),
            lineTotal: centiToMyr(d.totalCenti),
          };
        }
        const qty = Number(lead.qty ?? 0);
        const lineTotal = centiToMyr(lead.total_centi as number | null);
        const unitPrice = lead.unit_price_centi != null
          ? centiToMyr(lead.unit_price_centi)
          : qty > 0 ? lineTotal / qty : lineTotal;
        const desc = [lead.description, lead.description2].filter(Boolean).join(' · ');
        return {
          sku: (lead.item_code as string) ?? '—',
          description: desc || ((lead.item_code as string) ?? ''),
          sub: null,
          notes,
          qty,
          unitPrice,
          lineTotal,
        };
      });

      return {
        id: (so.doc_no as string) ?? docNo,
        date: so.so_date ?? null,
        deliveryDate: so.customer_delivery_date ?? null,
        paymentMethod: so.payment_method ?? null,
        customerName: (so.debtor_name as string) ?? '',
        customerAddressLines,
        customerPhone: so.phone ?? null,
        soldByName,
        soldByAddressLines: splitMyAddress(COMPANY_LEGAL.showroomLine),
        // No separate subtotal on the SO model — the total stands in (add-ons
        // ride inside the line totals), matching GET /mfg-sales-orders/mine.
        subtotal: total,
        paid,
        total,
        balance,
        signature,
        lines,
      };
    },
  });
