// ----------------------------------------------------------------------------
// Purchase Order PDF — AutoCount/DSL-style layout (PR #102 + 2026-06-12
// rebuild to the owner's DSL reference printout).
//
// Layout:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │              2990 HOME SDN. BHD.   (centered letterhead)         │
//   │              SSM 202501060667                                    │
//   │              E-28-02 & E-28-03, Menara SUEZCAP 2, KL Gateway,    │
//   │              No. 2, Jalan Kerinchi, …  59200 Kuala Lumpur …      │
//   ├──────────────────────────────────────────────────────────────────┤
//   │                       PURCHASE ORDER                             │
//   ├──────────────────────────────────────────────────────────────────┤
//   │  SUPPLIER NAME                  PO No.       : PO-2606-001       │
//   │  Address line 1                 Your Ref No. : SO-2605-014 (S/O) │
//   │  Address line 2                 Terms        : NET 30            │
//   │  TEL : …       FAX : …          Date         : 2026/06/12        │
//   │  Attn: …                        Delivery Date: 2026/06/19        │
//   │                                 Purchase Loc.: WH-KL · Main WH   │
//   │                                 Page         : 1 of N            │
//   ├──────────────────────────────────────────────────────────────────┤
//   │ Item | Our Code | Description | Transf. SO | UOM | Qty | U/Price │
//   │      |          |             |            |     |     | | Disc | Total
//   │  (Item = SUPPLIER code, bold. Description = model + composition +
//   │   supplier colour (our code) + variant attrs + remark + per-line
//   │   delivery date.)
//   ├──────────────────────────────────────────────────────────────────┤
//   │ RINGGIT MALAYSIA … ONLY                          TOTAL  9,999.00 │
//   │ E. & O.E.                                                        │
//   │ Authorised Signature          Supplier Acknowledgement           │
//   └──────────────────────────────────────────────────────────────────┘
//
// Letterhead comes from pdf-common COMPANY (= apps/pos legal.ts, the real
// registered entity). Page number prints on EVERY page header via the
// autotable didDrawPage hook + jsPDF putTotalPages.
// ----------------------------------------------------------------------------

import { COMPANY, amountInWordsMyr, fmtDocDate, fmtDocStamp } from './pdf-common';
import {
  loadSupplierDocData,
  supplierCodeFor,
  specsLine,
  type SupplierRecord,
} from './supplier-doc-data';

type PoHeader = {
  po_number:     string;
  /** Supplier id — drives the print-time binding lookup for lines that never
      snapshotted a supplier_sku AND the full supplier-master top-up (fax /
      attention / payment terms). Optional: missing id → '—' fallback. */
  supplier_id?:  string | null;
  status:        string;
  po_date:       string;
  expected_at:   string | null;
  currency:      string;
  subtotal_centi: number;
  tax_centi:     number;
  total_centi:   number;
  notes:         string | null;
  /** PR #102 — header extras for the AutoCount layout. All optional; the PDF
      renders dashes when blank so old POs without these fields still print. */
  your_ref_no?:           string | null;
  source_so_doc_no?:      string | null;
  purchase_location_name?: string | null;
  supplier?: {
    code:           string;
    name:           string;
    contact_person?: string | null;
    phone?:         string | null;
    fax?:           string | null;
    email?:         string | null;
    address?:       string | null;
    area?:          string | null;
    postcode?:      string | null;
    state?:         string | null;
    country?:       string | null;
    attention?:     string | null;
    payment_terms?: string | null;
  } | null;
};

type PoItem = {
  material_code: string;
  material_name: string;
  supplier_sku:  string | null;
  qty:           number;
  unit_price_centi: number;
  line_total_centi: number;
  /** PR #102 — AutoCount layout extras. All optional. */
  uom?:           string | null;
  discount_centi?: number | null;
  delivery_date?: string | null;
  notes?:         string | null;
  /** Supplier-facing dual-code layout — variants drive the Specs segment
      (fabric shows the SUPPLIER's colour code with ours alongside, plus
      divan/leg/seat heights and D1-style specials via buildVariantSummary). */
  item_group?:    string | null;
  description?:   string | null;
  description2?:  string | null;
  variants?:      Record<string, unknown> | null;
  /** 2026-06-12 — "Transferred SO" column. GET /mfg-purchase-orders/:id
      stamps each line's source SO doc_no (so_item_id → mfg_sales_order_items
      → doc_no). Null for manually-added / MRP / consignment lines. */
  so_doc_no?:     string | null;
};

const fmtMoney = (centi: number, currency: string): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtAmount = (centi: number): string =>
  (centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function generatePurchaseOrderPdf(
  header: PoHeader,
  items: PoItem[],
  opts?: { docTitle?: string },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const docTitle = opts?.docTitle ?? 'PURCHASE ORDER';

  /* Print-time lookups (all fail-soft): supplier SKU bindings + Fabric
     Converter colour map + the FULL supplier master record (the PO detail
     endpoint embeds only 7 fields — no fax / attention / payment_terms). */
  const { skuMap, fabricMap, supplier: fullSupplier } = await loadSupplierDocData(header.supplier_id, items);

  // ── Company letterhead (centered, AutoCount style) ────────────────
  let y = margin;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(COMPANY.name, pageW / 2, y, { align: 'center' });
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(COMPANY.reg, pageW / 2, y, { align: 'center' });
  y += 4;
  for (const line of COMPANY.addressLines) {
    doc.text(line, pageW / 2, y, { align: 'center' });
    y += 4;
  }
  y += 2;

  doc.setDrawColor(0); doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ── Title bar ─────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(docTitle, pageW / 2, y, { align: 'center' });
  y += 8;

  // ── Two-column block: supplier (left) + meta (right) ──────────────
  const leftX  = margin;
  const rightX = pageW / 2 + 4;
  const colW   = pageW / 2 - margin - 4;

  /* Embedded 7-field supplier first, full master record as the top-up for
     anything the embed omits (fax / attention / payment_terms / area /
     postcode / state / country). Both optional → '—' fallbacks. */
  const s: Partial<SupplierRecord> = { ...(fullSupplier ?? {}), ...(header.supplier ?? {}) };
  const sFull = fullSupplier ?? {};
  const supplierAddressLines = [
    s.address,
    sFull.area,
    [sFull.postcode, sFull.state].filter(Boolean).join(' ').trim() || null,
    sFull.country,
  ].filter(Boolean) as string[];

  // Border boxes so it looks like AutoCount
  doc.setDrawColor(120); doc.setLineWidth(0.2);
  const blockH = 40;
  doc.rect(leftX,  y, colW, blockH);
  doc.rect(rightX, y, colW, blockH);

  // LEFT: supplier name + address + TEL/FAX + Attn
  doc.setFont('helvetica', 'bold');  doc.setFontSize(10);
  doc.text(s.name ?? '—', leftX + 2, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  let ly = y + 9;
  supplierAddressLines.forEach((line) => {
    doc.text(String(line), leftX + 2, ly);
    ly += 4;
  });
  doc.text(`TEL : ${s.phone ?? sFull.mobile ?? ''}      FAX : ${sFull.fax ?? ''}`, leftX + 2, ly);
  ly += 4;
  doc.text(`Attn: ${sFull.attention ?? s.contact_person ?? ''}`, leftX + 2, ly);

  /* RIGHT: meta block. "Your Ref No." = the source S/O No. (AutoCount keeps
     the customer's reference here); falls back to per-line so_doc_no roll-up
     when the header never carried one. Terms = supplier payment terms.
     Page row is patched after pagination (we don't know N yet). */
  const lineSoDocs = [...new Set(items.map((it) => (it.so_doc_no ?? '').trim()).filter(Boolean))];
  const yourRef = header.your_ref_no
    ?? header.source_so_doc_no
    ?? (lineSoDocs.length > 0 ? lineSoDocs.join(', ') : '');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const metaLines: Array<[string, string]> = [
    ['PO No.',            header.po_number],
    ['Your Ref No.',      yourRef],
    ['Terms',             sFull.payment_terms ?? header.supplier?.payment_terms ?? ''],
    ['Date',              fmtDocDate(header.po_date)],
    ['Delivery Date',     header.expected_at ? fmtDocDate(header.expected_at) : ''],
    ['Purchase Location', header.purchase_location_name ?? ''],
    ['Page',              ''],                          // patched after pagination
  ];
  let my = y + 5;
  let pageRowY = 0;
  metaLines.forEach(([label, val]) => {
    doc.text(label,             rightX + 2,  my);
    doc.text(':',               rightX + 32, my);
    doc.text(String(val ?? ''), rightX + 35, my);
    if (label === 'Page') pageRowY = my;
    my += 4.5;
  });
  y += blockH + 2;

  // Owner's rule — supplier acts on THEIR codes; ours stay printed alongside.
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(80);
  doc.text('Codes shown are SUPPLIER codes; our reference in second column.', leftX, y + 2);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
  y += 6;

  // ── Items table ──────────────────────────────────────────────────
  // Dual-code DSL layout (Commander — supplier-facing purchasing docs):
  //   Item        = SUPPLIER's code, bold, FIRST (the code they act on)
  //   Our Code    = internal reference
  //   Description = name/model + composition (description2) + Specs
  //                 (supplier colour (our fabric code) via Fabric Converter +
  //                 divan/leg/seat heights + D1 specials via
  //                 buildVariantSummary inside specsLine) + line remark +
  //                 per-line delivery date
  //   Transf. SO | UOM | Qty | U/Price | Disc | Total
  type Row = [string, string, string, string, string, string, string, string, string];
  const rows: Row[] = items.map((it) => {
    const descParts = [
      it.description ?? it.material_name,
      (it.description2 ?? '').trim() || null,
      specsLine(it, fabricMap) || null,
      (it.notes ?? '').trim() ? `Remark: ${(it.notes ?? '').trim()}` : null,
      it.delivery_date ? `Delivery: ${fmtDocDate(it.delivery_date)}` : null,
    ].filter(Boolean) as string[];
    return [
      supplierCodeFor(it, skuMap),
      it.material_code,
      // Dedupe consecutive identical segments (description2 often equals the
      // live specs line) so the cell doesn't read the same string twice.
      [...new Set(descParts)].join('\n'),
      it.so_doc_no ?? '—',
      (it.uom ?? 'UNIT').toUpperCase(),
      String(it.qty),
      fmtAmount(it.unit_price_centi),
      it.discount_centi ? fmtAmount(it.discount_centi) : '',
      fmtAmount(it.line_total_centi),
    ];
  });

  /* Page-number on EVERY page header (didDrawPage) using the jsPDF
     total-pages placeholder, resolved by putTotalPages below. */
  const totalPagesExp = '{total_pages}';
  const drawPageHeader = (pageNumber: number) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80);
    doc.text(
      `${header.po_number} · Page ${pageNumber} of ${totalPagesExp}`,
      pageW - margin, 10, { align: 'right' },
    );
    doc.setTextColor(0);
  };

  autoTable(doc, {
    startY: y,
    head: [[
      'Item', 'Our Code', 'Description', 'Transf. SO', 'UOM', 'Qty',
      `U/Price ${header.currency}`, 'Disc.', `Total ${header.currency}`,
    ]],
    body: rows,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 }, lineColor: [120, 120, 120], lineWidth: 0.1 },
    headStyles: { fontStyle: 'bold', halign: 'left', valign: 'middle', lineWidth: { top: 0.4, bottom: 0.4 } as never },
    bodyStyles: { valign: 'top' },
    columnStyles: {
      0: { cellWidth: 24, fontStyle: 'bold' },
      1: { cellWidth: 22 },
      2: { cellWidth: 56 },
      3: { cellWidth: 20 },
      4: { cellWidth: 12 },
      5: { cellWidth: 10, halign: 'right' },
      6: { cellWidth: 16, halign: 'right' },
      7: { cellWidth: 12, halign: 'right' },
      8: { cellWidth: 16, halign: 'right' },
    },
    margin: { left: margin, right: margin, top: 16 },
    didDrawPage: (data) => drawPageHeader(data.pageNumber),
  });

  let lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 5;

  // ── Totals (right) + amount in words (left, AutoCount footer) ─────
  if (lastY > 250) { doc.addPage(); drawPageHeader(doc.getNumberOfPages()); lastY = 20; }
  const totalsX = pageW - margin - 70;
  const drawRow = (label: string, val: string, ry: number, bold = false, ruled = false) => {
    if (ruled) { doc.setDrawColor(0); doc.line(totalsX, ry - 3, pageW - margin, ry - 3); }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX,        ry);
    doc.text(val,   pageW - margin, ry, { align: 'right' });
  };
  doc.setFontSize(9);
  let totY = lastY;
  drawRow('Subtotal', fmtMoney(header.subtotal_centi, header.currency), totY); totY += 4;
  if (header.tax_centi > 0) {
    drawRow('Tax',    fmtMoney(header.tax_centi,      header.currency), totY); totY += 4;
  }
  doc.setFontSize(11);
  drawRow('TOTAL',    fmtMoney(header.total_centi,    header.currency), totY + 2, true, true);

  /* Amount in words — wrapped to the left half so a long amount never
     collides with the totals column. */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
  const words = doc.splitTextToSize(amountInWordsMyr(header.total_centi), totalsX - margin - 6) as string[];
  doc.text(words, margin, lastY);
  doc.setFont('helvetica', 'normal');
  let wordsY = lastY + words.length * 3.6 + 2;
  doc.setFontSize(8); doc.setTextColor(110);
  doc.text('E. & O.E.', margin, wordsY);
  doc.setTextColor(0);
  lastY = Math.max(totY + 8, wordsY + 6);

  // ── Notes / Remarks block (if present) ───────────────────────────
  if (header.notes) {
    doc.setFont('helvetica', 'bold');  doc.setFontSize(9);
    doc.text('Remarks:', margin, lastY);
    doc.setFont('helvetica', 'normal');
    lastY += 4;
    header.notes.split('\n').forEach((line) => {
      doc.text(line, margin, lastY);
      lastY += 4;
    });
    lastY += 4;
  }

  // ── Signature block ──────────────────────────────────────────────
  if (lastY > 240) { doc.addPage(); drawPageHeader(doc.getNumberOfPages()); lastY = 20; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.setDrawColor(120); doc.setLineWidth(0.2);
  const sigW = (pageW - margin * 2) / 2 - 4;
  doc.rect(margin,            lastY, sigW, 24);
  doc.rect(margin + sigW + 8, lastY, sigW, 24);
  doc.text(`Authorised Signature (${COMPANY.name})`, margin + 2,            lastY + 21);
  doc.text('Supplier Acknowledgement',               margin + sigW + 8 + 2, lastY + 21);
  lastY += 28;

  // ── Footer page numbers + meta-block "Page : 1 of N" patch ───────
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(
      `Page ${p} of ${pageCount}    ·    Generated ${fmtDocStamp()}`,
      pageW / 2, 287, { align: 'center' },
    );
    doc.setTextColor(0);
  }
  // Patch the meta block's reserved Page row on page 1 (exact AutoCount slot).
  if (pageRowY > 0) {
    doc.setPage(1);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(`1 of ${pageCount}`, rightX + 35, pageRowY);
  }
  /* Resolve the didDrawPage "{total_pages}" placeholder on every header. */
  const docWithTotals = doc as unknown as { putTotalPages?: (exp: string) => unknown };
  if (typeof docWithTotals.putTotalPages === 'function') {
    docWithTotals.putTotalPages(totalPagesExp);
  }

  // ── Save ──────────────────────────────────────────────────────────
  const safeName = (s.name || 'supplier').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32);
  doc.save(`${header.po_number}-${safeName}.pdf`);
}
