import { formatPhone } from '@2990s/shared/phone';
import { buildVariantSummary } from '@2990s/shared';
import {
  groupSoLinesForDisplay,
  pwpRewardNote,
  pwpTriggerNotes,
  type SoPwpCodeRow,
} from '@2990s/shared/so-line-display';
import {
  COMPANY,
  drawHeader,
  drawTwoColInfo,
  fmtDocDate,
  fmtRm,
  safeName,
} from './pdf-common';
import { loadFabricDescriptionMap } from './supplier-doc-data';

// ----------------------------------------------------------------------------
// Sales Order PDF generator — dynamic jspdf import so it doesn't bloat the
// main bundle. ~430 kB on its own (gzipped 143 kB); rendered into a vendor
// chunk by Vite's automatic chunk-splitter.
//
// 2026-06-12 REBUILD — layout mirrors the POS customer printout
// (apps/pos/src/pages/SalesOrderPrint.tsx), the document the owner signed
// off as the SO gold standard. INTERNAL + CUSTOMER-facing: our codes only,
// NO supplier data ever.
//
// Layout (A4 portrait):
//   1. Header: real letterhead (pdf-common COMPANY = legal.ts COMPANY_LEGAL)
//      left; SALES ORDER + SO no / date / status right
//   2. ORDER REFERENCE / DELIVERY ESTIMATE meta blocks (processing date +
//      delivery date — "To be confirmed" when null, like POS)
//   3. BILL TO / SOLD BY columns (delivery address = ship_to_address ??
//      address1-4; phone; family/emergency contact; agent + sales location)
//   4. Line items table: SKU | Description (variant detail second line —
//      compartments · fabric / SEAT / LEG, fabric code enriched with the
//      fabric_trackings description; PWP notes; remark) | Qty | Unit |
//      Disc | Line Total
//   5. PAYMENTS RECEIVED ledger (mfg_sales_order_payments rows)
//   6. Totals: SUBTOTAL / PAID TO DATE / TOTAL / BALANCE DUE
//   7. Customer signature (stored signature_b64 image when present) +
//      name · phone, company authorised signature
//   8. Numbered terms — RECEIPT_TERMS wording from apps/pos/src/lib/legal.ts
//   9. Footer: doc no · portal label · page n of m
// ----------------------------------------------------------------------------

type SoHeader = {
  doc_no: string;
  so_date: string;
  status: string;
  debtor_code: string | null;
  debtor_name: string;
  agent: string | null;
  branding: string | null;
  venue: string | null;
  ref: string | null;
  po_doc_no: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
  mattress_sofa_centi: number;
  bedframe_centi: number;
  accessories_centi: number;
  others_centi: number;
  local_total_centi: number;
  /* Expected deposit target the commander sets on the SO. Distinct from
     amounts actually collected — those live in the payments ledger below. */
  deposit_centi?: number;
  line_count: number;
  currency: string;
  note: string | null;
  /* 2026-06-12 rebuild — POS-printout parity fields. All optional: every
     caller passes the raw GET /mfg-sales-orders/:docNo row verbatim, and the
     Consignment Order reuse path (no such columns) simply omits them. */
  sales_location?: string | null;
  customer_po?: string | null;
  processing_date?: string | null;
  customer_delivery_date?: string | null;
  internal_expected_dd?: string | null;
  ship_to_address?: string | null;
  email?: string | null;
  city?: string | null;
  postcode?: string | null;
  customer_state?: string | null;
  /* Second/family contact — the SO schema has no phone2/contact column; the
     emergency_contact_* trio (POS handover "Emergency" phase) is the family
     contact and prints as such. */
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relationship?: string | null;
  /* Authoritative received-to-date rollup stamped by GET /:docNo (ledger +
     legacy header deposit). Falls back to summing `payments` when absent. */
  paid_centi_total?: number | null;
  /* POS handover customer signature (data-URL or bare base64 PNG). */
  signature_b64?: string | null;
};

type SoItem = {
  id: string;
  item_group: string;
  item_code: string;
  description: string | null;
  description2?: string | null;
  uom: string;
  qty: number;
  unit_price_centi: number;
  discount_centi: number;
  total_centi: number;
  variants: Record<string, unknown> | null;
  remark?: string | null;
};

/* Mirrors flow-queries.ts `SoPayment`. Re-declared here to keep the PDF
   helper free of TanStack/Supabase imports — it's called from both the
   detail page (where the hook supplies the data) and the list page (where
   a one-shot fetch supplies it). Fields the PDF doesn't render are still
   accepted so callers can pass the row verbatim. */
type SoPayment = {
  paid_at: string;
  /* 2026-06-06 payment-method unify — 'installment' is first-class. */
  method: 'merchant' | 'transfer' | 'cash' | 'installment';
  /* Task #122 (cascade) — merchant_provider / installment_months are now
     open string + integer (driven by the so_dropdown_options cascade
     categories). online_type is the new Online sub-type column. */
  merchant_provider: string | null;
  installment_months: number | null;
  online_type?: string | null;
  approval_code: string | null;
  amount_centi: number;
  account_sheet: string | null;
  collected_by_name: string | null;
  note: string | null;
};

/* Numbered T&C — copied verbatim from apps/pos/src/lib/legal.ts
   RECEIPT_TERMS (the POS printout is the legal record; keep in sync). */
const RECEIPT_TERMS: readonly string[] = [
  'This sales order becomes a binding tax invoice once goods are delivered and full payment is reconciled.',
  'Balance due is payable in full before delivery. Bank transfer, DuitNow QR, and cheque accepted.',
  'Delivery date is best-effort and may shift ±3 working days subject to operation confirmation.',
  'Stair-carry surcharges (if any) are billed on this sales order and are not invoiced separately on the DO.',
  'Once the delivery date has been confirmed, any subsequent request to change or extend the date will incur a rescheduling surcharge.',
];

/* The variant keys that can carry an internal fabric code, mirrored from
   supplier-doc-data's FABRIC_VARIANT_KEYS. The SO PDF maps each present code
   to "CODE — fabric_trackings.fabric_description" (customer-readable). */
const FABRIC_VARIANT_KEYS = ['fabricCode', 'colorCode', 'fabricColor'] as const;

/** Collect internal fabric codes riding in the items' variants JSONB. */
const collectFabricCodes = (items: SoItem[]): string[] => {
  const codes = new Set<string>();
  for (const it of items) {
    const v = it.variants;
    if (!v || typeof v !== 'object') continue;
    for (const key of FABRIC_VARIANT_KEYS) {
      const raw = v[key];
      if (typeof raw === 'string' && raw.trim()) codes.add(raw.trim());
    }
  }
  return [...codes];
};

/* Variant second line for a single (non-folded) item: the shared
   buildVariantSummary (same string every grid shows — fabric / DIVAN+LEG /
   GAP / SEAT / SPECIAL) with each fabric code enriched to
   "EZ-001 — <fabric_description>" when the Fabric Tracking master knows it.
   Falls back to the stored description2 snapshot when the line has no
   variants object (legacy rows). */
const variantLine = (it: SoItem, fabricDescMap: Map<string, string>): string => {
  const v = it.variants;
  if (!v || typeof v !== 'object') return (it.description2 ?? '').trim();
  let mapped: Record<string, unknown> = v;
  for (const key of FABRIC_VARIANT_KEYS) {
    const raw = v[key];
    if (typeof raw === 'string') {
      const desc = fabricDescMap.get(raw.trim());
      if (desc) {
        if (mapped === v) mapped = { ...v }; // clone once, on demand
        mapped[key] = `${raw.trim()} — ${desc}`;
      }
    }
  }
  return buildVariantSummary(it.item_group ?? null, mapped) || (it.description2 ?? '').trim();
};

/* Human-readable method label for the PDF Payments table.
   - merchant → "Merchant (GHL)" or "Merchant (GHL) · 6m installment"
   - transfer → "Online (TNG)" etc.
   - cash     → "Cash"
   Mirrors the on-screen METHOD_LABEL + provider/installment pill in
   SalesOrderDetail's PaymentCard but flattened to a single cell. */
const methodLabel = (p: SoPayment): string => {
  if (p.method === 'merchant') {
    const base = p.merchant_provider ? `Merchant (${p.merchant_provider})` : 'Merchant';
    return p.installment_months ? `${base} · ${p.installment_months}m installment` : base;
  }
  /* Task #122 (cascade) — surface the Online sub-type (Bank Transfer /
     TNG / Cheque / DuitNow) so the printed PDF reads as the user actually
     filed it, not a generic "Bank Transfer". */
  if (p.method === 'transfer') return p.online_type ? `Online (${p.online_type})` : 'Online';
  /* 2026-06-06 payment-method unify — installment rows print their term. */
  if (p.method === 'installment') {
    const base = p.merchant_provider ? `Installment (${p.merchant_provider})` : 'Installment';
    return p.installment_months ? `${base} · ${p.installment_months}m` : base;
  }
  return 'Cash';
};

/* Follow-up #83 — action selects how the rendered PDF is delivered:
   - 'save'    → traditional doc.save() download (default, back-compat)
   - 'print'   → render into a hidden iframe and trigger print dialog,
                 skipping the Downloads folder round-trip
   - 'preview' → open as a blob URL in a new tab (no print, no download) */
export type PdfAction = 'save' | 'print' | 'preview';

/* Mount a blob URL in a hidden iframe and (optionally) trigger print.
   Cleanup is deferred 60 s so the OS print dialog can hold the iframe
   document until the user closes it. */
const renderViaIframe = (blobUrl: string, andPrint: boolean): void => {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = blobUrl;
  document.body.appendChild(iframe);
  if (andPrint) {
    iframe.onload = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* Some browsers throw if the PDF viewer hasn't fully hydrated.
           Worst case the user sees the iframe content briefly; we still
           clean up below. */
      }
    };
  }
  window.setTimeout(() => {
    try { document.body.removeChild(iframe); } catch { /* already detached */ }
    URL.revokeObjectURL(blobUrl);
  }, 60_000);
};

export async function generateSalesOrderPdf(
  header: SoHeader,
  items: SoItem[],
  payments: SoPayment[] = [],
  action: PdfAction = 'save',
  /* PWP vouchers this SO's trigger items issued (GET /:docNo `pwpCodes`) —
     used to mark trigger lines. Optional so older callers stay valid. */
  pwpCodes: SoPwpCodeRow[] = [],
  opts?: { docTitle?: string; docNoLabel?: string },
): Promise<void> {
  // Dynamic import — code-split into a vendor chunk.
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  /* Fabric Tracking lookup (fail-soft, before any drawing): internal fabric
     code → fabric_description so the customer reads "EZ-001 — <description>"
     instead of a bare internal code. */
  const fabricDescMap = await loadFabricDescriptionMap(collectFabricCodes(items));

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  // ── Header (shared pdf-common letterhead) ─────────────────────────
  let y = drawHeader(doc, {
    docTitle: opts?.docTitle ?? 'SALES ORDER',
    rightMeta: [
      { label: opts?.docNoLabel ?? 'Doc No', value: header.doc_no },
      { label: 'Date',   value: fmtDocDate(header.so_date) },
      { label: 'Status', value: header.status.replace(/_/g, ' ') },
    ],
  });

  // ── ORDER REFERENCE / DELIVERY ESTIMATE meta blocks ──────────────
  /* Mirrors the POS printout's MetaRow: order ref + placed date on the left;
     delivery estimate + processing date on the right. "To be confirmed"
     when no delivery date is set yet — same wording as POS. */
  const deliveryDate = header.customer_delivery_date ?? header.internal_expected_dd ?? null;
  y = drawTwoColInfo(doc, y, 'ORDER REFERENCE', 'DELIVERY ESTIMATE',
    [
      header.doc_no,
      `Placed: ${fmtDocDate(header.so_date)}`,
      header.ref ? `Reference: ${header.ref}` : null,
      header.po_doc_no ? `Customer PO: ${header.po_doc_no}` : null,
    ],
    [
      `Delivery date: ${deliveryDate ? fmtDocDate(deliveryDate) : 'To be confirmed'}`,
      `Processing date: ${header.processing_date ? fmtDocDate(header.processing_date) : '—'}`,
    ],
  );

  // ── BILL TO / SOLD BY ─────────────────────────────────────────────
  /* DELIVERY address rule (owner): ship_to_address wins; legacy address1-4
     (+ "postcode city state" tail, like POS so-doc.ts) when blank. */
  const addressLines = (header.ship_to_address ?? '').trim()
    ? (header.ship_to_address as string).split('\n').map((s) => s.trim()).filter(Boolean)
    : [
        header.address1, header.address2, header.address3, header.address4,
        [header.postcode, header.city, header.customer_state].filter(Boolean).join(' ') || null,
      ].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  /* Family / second contact = the emergency_contact_* trio (POS handover
     "Emergency" phase). The SO schema has NO phone2/contact-person column —
     this is the only second-contact field family, so it prints here. */
  const familyContact = (header.emergency_contact_name ?? '').trim() || (header.emergency_contact_phone ?? '').trim()
    ? [
        'Family contact: ',
        (header.emergency_contact_name ?? '').trim(),
        (header.emergency_contact_phone ?? '').trim() ? ` · ${formatPhone((header.emergency_contact_phone ?? '').trim())}` : '',
        (header.emergency_contact_relationship ?? '').trim() ? ` (${(header.emergency_contact_relationship ?? '').trim()})` : '',
      ].join('')
    : null;
  y = drawTwoColInfo(doc, y, 'BILL TO', 'SOLD BY',
    [
      header.debtor_name,
      header.debtor_code ? `Code: ${header.debtor_code}` : null,
      ...addressLines,
      /* Task #91 — pretty Malaysian format on customer-facing PDF. */
      header.phone ? `Tel: ${formatPhone(header.phone)}` : null,
      header.email ? `Email: ${header.email}` : null,
      familyContact,
    ],
    [
      header.agent ? `Agent: ${header.agent}` : null,
      header.sales_location ? `Sales location: ${header.sales_location}` : null,
      header.venue ? `Venue: ${header.venue}` : null,
      header.branding ? `Branding: ${header.branding}` : null,
      header.note ? `Note: ${header.note}` : null,
    ],
  );

  // ── Line items table ─────────────────────────────────────────────
  /* Loo 2026-06-05 — customer-facing fold: per-module sofa SKU lines
     (variants.buildKey groups from the P3 split) render as ONE Model row with
     the combined price; the persisted lines and every Backend grid stay
     per-SKU. Second description line = compartments · fabric / SEAT / LEG
     (composition + shared variant summary), matching the POS printout. PWP
     notes ride inside the Description cell: a reward line shows the voucher
     it consumed, a trigger line shows the codes this SO issued (USED → short
     reference; otherwise "issued, not redeemed yet"). */
  const groups = groupSoLinesForDisplay(items);
  const tableRows = groups.map((g) => {
    const lead = g.lines[0]!;
    const notes = [
      pwpRewardNote(lead.variants),
      ...pwpTriggerNotes(g.lines.map((l) => l.item_code), pwpCodes),
    ].filter((n): n is NonNullable<typeof n> => n != null).map((n) => n.text);
    /* Loo D3 — per-line operator remark prints as its own note line in the
       Description cell. For a folded sofa build use the group's first remark;
       otherwise the lead line's own remark. */
    const remarkText = g.kind === 'sofa-build' && g.display
      ? g.display.remark
      : (typeof lead.remark === 'string' && lead.remark.trim() !== '' ? lead.remark : null);
    if (remarkText) notes.push(`Remark: ${remarkText}`);
    if (g.kind === 'sofa-build' && g.display) {
      const d = g.display;
      const sub = [d.composition, d.description2].filter(Boolean).join(' · ');
      return [
        d.itemCode,
        [d.description, sub, ...notes].filter(Boolean).join('\n'),
        `${d.qty} ${lead.uom}`,
        fmtRm(d.unitPriceCenti, header.currency),
        d.discountCenti > 0 ? fmtRm(d.discountCenti, header.currency) : '—',
        fmtRm(d.totalCenti, header.currency),
      ];
    }
    const sub = variantLine(lead, fabricDescMap);
    const desc = [lead.description ?? lead.item_code, sub, ...notes].filter(Boolean).join('\n');
    return [
      lead.item_code,
      desc,
      String(lead.qty) + ' ' + lead.uom,
      fmtRm(lead.unit_price_centi, header.currency),
      lead.discount_centi > 0 ? fmtRm(lead.discount_centi, header.currency) : '—',
      fmtRm(lead.total_centi, header.currency),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['SKU', 'Description', 'Qty', 'Unit Price', 'Disc', 'Line Total']],
    body: tableRows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 86 },
      2: { cellWidth: 16, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  // jspdf-autotable mutates doc by writing __lastAutoTable_finalY into internals.
  // Read it off the typed (any) shim so we know where to continue drawing.
  let ty = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  // ── PAYMENTS RECEIVED ledger ──────────────────────────────────────
  // Sources transactions from the payments ledger (mfg_sales_order_payments)
  // instead of the legacy single-row header columns (deprecated PR-C).
  if (ty > 250) { doc.addPage(); ty = margin; }
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('PAYMENTS RECEIVED', margin, ty);
  ty += 4;

  if (payments.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text('No payments recorded.', margin, ty);
    doc.setTextColor(0);
    ty += 6;
  } else {
    const payRows = payments.map((p) => [
      fmtDocDate(p.paid_at),
      methodLabel(p),
      p.approval_code ?? '—',
      p.collected_by_name ?? '—',
      fmtRm(p.amount_centi, header.currency),
    ]);
    autoTable(doc, {
      startY: ty,
      head: [['Date', 'Method', 'Approval Code', 'Collected By', 'Amount']],
      body: payRows,
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 60 },
        2: { cellWidth: 32 },
        3: { cellWidth: 'auto' },
        4: { cellWidth: 28, halign: 'right' },
      },
      margin: { left: margin, right: margin },
    });
    ty = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? ty) + 6;
  }

  // ── Totals: SUBTOTAL / PAID TO DATE / TOTAL / BALANCE DUE ─────────
  /* POS-printout parity: the SO model has no separate subtotal — the grand
     total stands in (add-ons ride inside the line totals). Paid-to-date
     prefers the authoritative paid_centi_total stamped by GET /:docNo
     (ledger + legacy header deposit), falling back to summing the rows. */
  const subtotalCenti = header.local_total_centi;
  const paidCenti = typeof header.paid_centi_total === 'number'
    ? header.paid_centi_total
    : payments.reduce((sum, p) => sum + (p.amount_centi || 0), 0);
  const balanceCenti = Math.max(0, subtotalCenti - paidCenti);
  if (ty > 240) { doc.addPage(); ty = margin; }
  const totalsX = pageW - margin - 70;
  doc.setFontSize(9);
  const drawRow = (label: string, val: string, ry: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX, ry);
    doc.text(val, pageW - margin, ry, { align: 'right' });
  };
  drawRow('Subtotal',     fmtRm(subtotalCenti, header.currency), ty);     ty += 4;
  /* Standard-checklist tax line — the SO model carries no header tax (prices
     are tax-inclusive / exempt), so this prints as a dash, not a number. */
  drawRow('Tax',          '—',                                   ty);     ty += 4;
  drawRow('Total',        fmtRm(subtotalCenti, header.currency), ty);     ty += 4;
  drawRow('Paid to date', fmtRm(paidCenti,     header.currency), ty);     ty += 2;
  doc.setDrawColor(0);
  doc.line(totalsX, ty, pageW - margin, ty);
  doc.setFontSize(11);
  drawRow('BALANCE DUE', fmtRm(balanceCenti, header.currency), ty + 5, true);
  ty += 12;

  // Expected-deposit line — only shown when the commander has set one
  // on the header. Keeps the "target vs. collected" distinction visible.
  if ((header.deposit_centi ?? 0) > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
      `Expected deposit: ${fmtRm(header.deposit_centi ?? 0, header.currency)}`,
      margin, ty,
    );
    doc.setTextColor(0);
    ty += 5;
  }

  // ── Signature boxes — customer (with stored POS signature) + company ──
  if (ty > 225) { doc.addPage(); ty = margin; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Customer Signature', margin, ty);
  doc.text(`${COMPANY.name} Authorised Signature`, pageW / 2 + 5, ty);
  ty += 2;
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setDrawColor(120);
  const sigW = (pageW - margin * 2) / 2 - 5;
  doc.rect(margin, ty, sigW, 22);
  doc.rect(pageW / 2 + 5, ty, sigW, 22);
  doc.setLineDashPattern([], 0);
  /* POS handover signature (signature_b64) renders INSIDE the customer box —
     same as the POS printout. Fail-soft: a malformed image just leaves the
     box blank for a wet-ink signature. */
  const rawSig = (header.signature_b64 ?? '').trim();
  if (rawSig) {
    try {
      const dataUrl = rawSig.startsWith('data:') ? rawSig : `data:image/png;base64,${rawSig}`;
      doc.addImage(dataUrl, 'PNG', margin + 2, ty + 1, sigW - 4, 20);
    } catch { /* leave the box blank */ }
  }
  ty += 26;
  // Name · phone under the customer box, mirroring SalesOrderPrint.tsx.
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80);
  doc.text(
    [header.debtor_name, header.phone ? formatPhone(header.phone) : null].filter(Boolean).join(' · '),
    margin, ty,
  );
  doc.setTextColor(0);
  ty += 6;

  // ── Numbered terms (POS RECEIPT_TERMS wording) ────────────────────
  if (ty > 255) { doc.addPage(); ty = margin; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('Terms & Conditions', margin, ty);
  ty += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  RECEIPT_TERMS.forEach((t, i) => {
    const wrapped = doc.splitTextToSize(`${i + 1}. ${t}`, pageW - margin * 2) as string[];
    doc.text(wrapped, margin, ty);
    ty += wrapped.length * 3.2 + 0.8;
  });
  doc.setTextColor(0);

  // ── Footer: doc no · portal label · page n of m on every page ────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(header.doc_no, margin, 290);
    doc.text(`${COMPANY.portalLabel} · ${fmtDocDate(header.so_date)}`, pageW / 2, 290, { align: 'center' });
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin, 290, { align: 'right' });
    doc.setTextColor(0);
  }

  // Filename: SO-009001-DebtorName.pdf
  const filename = `${header.doc_no}-${safeName(header.debtor_name || 'customer')}.pdf`;

  /* Follow-up #83 — Dispatch on action.
     - save:    write a real file (download)
     - print:   blob URL → hidden iframe → window.print()
     - preview: blob URL → new tab (browser PDF viewer) */
  if (action === 'save') {
    doc.save(filename);
    return;
  }
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  if (action === 'preview') {
    /* New-tab preview. The blob URL stays valid until revoked; we leave
       it to the 60 s timer so the new tab has time to fetch the PDF. */
    window.open(blobUrl, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }
  // action === 'print'
  renderViaIframe(blobUrl, true);
}
