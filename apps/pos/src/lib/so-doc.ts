import { useQuery } from '@tanstack/react-query';
import {
  groupSoLinesForDisplay,
  pwpRewardNote,
  pwpTriggerNotes,
  sortSoLinesByGroupRank,
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
  /** Per-line operator remark (spec 2026-06-06 D3 — prints for the customer).
   *  Folded sofa builds surface the fold's remark (first non-empty by
   *  cellIndex); single lines read their own column. */
  remark: string | null;
  qty: number;
  unitPrice: number; // MYR
  lineTotal: number; // MYR
}

/** One row of the SO payment ledger, flattened for the customer-facing doc
 *  (Loo 2026-06-09 — show every tender + amount when a customer splits the
 *  payment across methods/visits). Sourced from
 *  GET /mfg-sales-orders/:docNo/payments. */
export interface PrintablePayment {
  id: string;
  date: string | null; // paid_at (YYYY-MM-DD)
  /** Flattened method label, identical to the backend SO PDF:
   *  "Merchant (GHL) · 6m installment" / "Online (TNG)" / "Cash". */
  methodLabel: string;
  approvalCode: string | null;
  amount: number; // MYR
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
  /** Per-tender breakdown (deposit + every drawer payment). May be empty for
   *  unpaid SOs or an older API build without the payments endpoint. */
  payments: PrintablePayment[];
  signature: string | null; // data URL, ready for <img src>
  lines: PrintableLine[];
}

// mfg money columns are in centi (1/100 MYR), same as GET /mfg-sales-orders/mine.
const centiToMyr = (c: number | null | undefined): number => (c ?? 0) / 100;

/* Flatten a payment-ledger row to one human label. Mirrors the backend SO PDF
   (apps/backend/src/lib/sales-order-pdf.ts → methodLabel) byte-for-byte so the
   customer-facing print and the backend-issued PDF read identically. */
function paymentMethodLabel(p: {
  method?: string | null;
  merchant_provider?: string | null;
  online_type?: string | null;
  installment_months?: number | null;
}): string {
  if (p.method === 'merchant') {
    const base = p.merchant_provider ? `Merchant (${p.merchant_provider})` : 'Merchant';
    return p.installment_months ? `${base} · ${p.installment_months}m installment` : base;
  }
  if (p.method === 'transfer') return p.online_type ? `Online (${p.online_type})` : 'Online';
  if (p.method === 'installment') {
    const base = p.merchant_provider ? `Installment (${p.merchant_provider})` : 'Installment';
    return p.installment_months ? `${base} · ${p.installment_months}m` : base;
  }
  return 'Cash';
}

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

      // Fetch the SO and its payment ledger together — the per-tender
      // breakdown is a separate endpoint (GET /:docNo/payments), the same one
      // the staff order drawer consumes.
      const auth = { authorization: `Bearer ${token}` };
      const [res, payRes] = await Promise.all([
        fetch(`${API_URL}/mfg-sales-orders/${encodeURIComponent(docNo)}`, { headers: auth }),
        fetch(`${API_URL}/mfg-sales-orders/${encodeURIComponent(docNo)}/payments`, { headers: auth }),
      ]);
      if (!res.ok) throw new Error(`GET /mfg-sales-orders/${docNo} failed (${res.status})`);
      const body = (await res.json()) as {
        salesOrder: Record<string, any>;
        items: Record<string, any>[];
        pwpCodes?: SoPwpCodeRow[];
      };
      const so = body.salesOrder ?? {};
      const items = body.items ?? [];
      const pwpCodes = body.pwpCodes ?? [];

      /* Per-tender breakdown. Oldest-first reads like a receipt (deposit →
         balance). A failure or an older API without the endpoint degrades to
         an empty list — the doc still renders with the aggregate totals. */
      let payments: PrintablePayment[] = [];
      try {
        if (payRes.ok) {
          const payBody = (await payRes.json()) as { payments?: Record<string, any>[] };
          payments = (payBody.payments ?? [])
            .map((p) => ({
              id: String(p.id),
              date: typeof p.paid_at === 'string' ? p.paid_at : null,
              methodLabel: paymentMethodLabel(p),
              approvalCode:
                typeof p.approval_code === 'string' && p.approval_code.trim()
                  ? p.approval_code.trim()
                  : null,
              amount: centiToMyr(p.amount_centi),
            }))
            .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
        }
      } catch {
        /* leave payments empty — totals block still shows Paid to date */
      }

      // Bill-to address: address1..4 then "postcode city state". Skip blanks.
      const tail = [so.postcode, so.city, so.customer_state].filter(Boolean).join(' ');
      const customerAddressLines = [so.address1, so.address2, so.address3, so.address4, tail]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);

      // Sold by (Loo 2026-06-06: "fix this, future will have new venue") —
      // per-SO lookup: the order's stamped venue (venue_id first, the venue
      // name text as a fallback key) resolves name + street address from the
      // venues master. Orders with NO venue (admin-placed tests) and any
      // lookup failure fall back to the legal.ts defaults, so the document
      // never renders a blank seller.
      let soldByName: string = COMPANY_LEGAL.showroomName;
      let soldByAddress: string = COMPANY_LEGAL.showroomLine;
      try {
        const venueId = typeof so.venue_id === 'string' && so.venue_id ? so.venue_id : null;
        const venueName = typeof so.venue === 'string' && so.venue.trim() ? so.venue.trim() : null;
        if (venueId || venueName) {
          const q = supabase.from('venues').select('name, address').limit(1);
          const { data: vRows } = venueId ? await q.eq('id', venueId) : await q.eq('name', venueName!);
          const v = (vRows ?? [])[0] as { name?: string | null; address?: string | null } | undefined;
          if (v?.name) soldByName = v.name;
          else if (venueName) soldByName = venueName;
          if (v?.address?.trim()) soldByAddress = v.address.trim();
        }
      } catch { /* keep legal.ts fallback */ }

      const total = centiToMyr(so.total_revenue_centi);
      /* Received-to-date = the live payments-ledger rollup the API now returns
         (paid_centi_total: deposit + every drawer payment). Fall back to the
         legacy header columns only if an older API build omits it. This is why
         the print showed "Deposit paid 0.00" before — paid_centi is deprecated
         and a balance payment lands in the ledger, not the header. */
      const paid = centiToMyr(so.paid_centi_total ?? so.paid_centi ?? so.deposit_centi);
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
      /* Priority lines (Loo 2026-06-12): mains (sofa/mattress/bedframe)
         lead, accessories follow, services close — render-time so SOs
         booked before the create path persisted this order print right. */
      const groups = groupSoLinesForDisplay(
        sortSoLinesByGroupRank(
          items.filter((it) => !it.cancelled) as Array<Record<string, any> & { item_code: string }>,
          (l) => l.item_group as string | null | undefined,
        ),
      );
      /* Option A (Loo 2026-06-12): since PR #553 the remark also renders
         INSIDE Description 2's SPECIAL segment ("SPECIAL: <remark> (+RM750)"),
         so the separate "Remark:" line printed the same text twice. Print it
         only when the text above does NOT already contain the remark verbatim
         — pre-#553 orders (persisted description2 without the SPECIAL remark)
         keep their Remark line. */
      const remarkUnlessShownAbove = (
        remark: unknown,
        shownAbove: string | null,
      ): string | null => {
        const r = typeof remark === 'string' ? remark.trim() : '';
        if (!r) return null;
        return shownAbove && shownAbove.includes(r) ? null : r;
      };
      const lines: PrintableLine[] = groups.map((g) => {
        const lead = g.lines[0]!;
        const notes: SoPwpNote[] = [
          pwpRewardNote(lead.variants),
          ...pwpTriggerNotes(g.lines.map((l) => l.item_code as string), pwpCodes),
        ].filter((n): n is SoPwpNote => n != null);
        if (g.kind === 'sofa-build' && g.display) {
          const d = g.display;
          const sub = [d.composition, d.description2].filter(Boolean).join(' · ') || null;
          return {
            sku: d.itemCode,
            description: d.description,
            sub,
            notes,
            remark: remarkUnlessShownAbove(d.remark, sub),
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
          remark: remarkUnlessShownAbove(lead.remark, desc || null),
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
        soldByAddressLines: splitMyAddress(soldByAddress),
        // No separate subtotal on the SO model — the total stands in (add-ons
        // ride inside the line totals), matching GET /mfg-sales-orders/mine.
        subtotal: total,
        paid,
        total,
        balance,
        payments,
        signature,
        lines,
      };
    },
  });
