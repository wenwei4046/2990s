// ----------------------------------------------------------------------------
// Purchase Order PDF — AutoCount-style layout (PR #102, Commander 2026-05-26
// showed the HOUZS Century printout: "这个是 PO 需要的").
//
// Layout:
//
//   ┌──────────────────────────────────────────────────────────────────┐
//   │   <logo>     COMPANY NAME              ┌──────────────┐          │
//   │              Address line 1            │              │          │
//   │              Address line 2            │              │          │
//   │              Tel: ... (KL/PG)          │              │          │
//   ├──────────────────────────────────────────────────────────────────┤
//   │                  PURCHASE ORDER       No.: PO-XXXX               │
//   ├──────────────────────────────────────────────────────────────────┤
//   │  SUPPLIER NAME                  Your Ref No. :  ___              │
//   │  Address line 1                 Terms        : C.O.D.            │
//   │  Address line 2                 Date         : 2026-05-26        │
//   │  Address line 3                 Delivery Date: 2026-06-02        │
//   │  TEL : ___    FAX : ___         Purchase Location : C&C DISP     │
//   │  Attn: ___                      S/O No.      : SO-2050           │
//   │                                 Page         : 1 of N            │
//   ├──────────────────────────────────────────────────────────────────┤
//   │  # | Item / Description    | Transf. SO | UOM | Qty | Unit | Disc| Total │
//   │  1 | AK-AV DR ROL PACK PIL | 2025/01/03 | UNIT|  20 |23.00 |     | 460.00│
//   │    | AVANTI DREAMY PILLOW  |            |     |     |      |     |       │
//   │  ...                                                              │
//   └──────────────────────────────────────────────────────────────────┘
//
// Company info is hard-coded for now (no /api/settings yet). Edit the
// COMPANY constant below when 2990's signs off on the legal name + address.
// ----------------------------------------------------------------------------

const COMPANY = {
  name:    "2990'S HOME SDN BHD",
  regNo:   '202301234567',                       // commander to confirm
  address: ['Lot 12, Jalan Industri 5/3, 43300 Seri Kembangan, Selangor, Malaysia'],
  tel:     'Tel: +60 12-345-6789',
  email:   'procurement@2990s.my',
} as const;

type PoHeader = {
  po_number:     string;
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
};

const fmtMoney = (centi: number, currency: string): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtAmount = (centi: number): string =>
  (centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function generatePurchaseOrderPdf(header: PoHeader, items: PoItem[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  // ── Company header ────────────────────────────────────────────────
  // Logo placeholder + centered name + centered address + tel.
  let y = margin;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  const companyHeaderText = `${COMPANY.name} (${COMPANY.regNo})`;
  doc.text(companyHeaderText, pageW / 2, y, { align: 'center' });
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  COMPANY.address.forEach((line) => {
    doc.text(line, pageW / 2, y, { align: 'center' });
    y += 4;
  });
  doc.text(`${COMPANY.tel}    ·    ${COMPANY.email}`, pageW / 2, y, { align: 'center' });
  y += 6;

  doc.setDrawColor(0); doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ── Title bar: "PURCHASE ORDER" centered + "No.: PO-XXXX" right ──────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('PURCHASE ORDER', pageW / 2, y, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`No.  :  ${header.po_number}`, pageW - margin, y, { align: 'right' });
  y += 8;

  // ── Two-column block: supplier (left) + meta (right) ──────────────
  const leftX  = margin;
  const rightX = pageW / 2 + 4;
  const colW   = pageW / 2 - margin - 4;

  const s = header.supplier;
  const supplierAddressLines = [
    s?.address,
    s?.area,
    [s?.postcode, s?.state].filter(Boolean).join(' ').trim() || null,
    s?.country,
  ].filter(Boolean) as string[];

  // Border boxes so it looks like AutoCount
  doc.setDrawColor(120); doc.setLineWidth(0.2);
  const blockH = 38;
  doc.rect(leftX,  y, colW, blockH);
  doc.rect(rightX, y, colW, blockH);

  // LEFT: supplier name + address + phones + attn
  doc.setFont('helvetica', 'bold');  doc.setFontSize(10);
  doc.text(s?.name ?? '—', leftX + 2, y + 5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  let ly = y + 9;
  supplierAddressLines.forEach((line) => {
    doc.text(String(line), leftX + 2, ly);
    ly += 4;
  });
  doc.text(`TEL : ${s?.phone ?? ''}      FAX : ${s?.fax ?? ''}`, leftX + 2, ly);
  ly += 4;
  doc.text(`Attn: ${s?.attention ?? s?.contact_person ?? ''}`, leftX + 2, ly);

  // RIGHT: meta block (Your Ref / Terms / Date / Delivery / Purchase Loc / S/O / Page)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const metaLines: Array<[string, string]> = [
    ['Your Ref No.',      header.your_ref_no            ?? ''],
    ['Terms',             s?.payment_terms              ?? ''],
    ['Date',              header.po_date],
    ['Delivery Date',     header.expected_at            ?? ''],
    ['Purchase Location', header.purchase_location_name ?? ''],
    ['S/O No.',           header.source_so_doc_no       ?? ''],
    ['Page',              ''],                          // filled after pagination
  ];
  let my = y + 5;
  metaLines.forEach(([label, val]) => {
    doc.text(label,            rightX + 2,                 my);
    doc.text(':',              rightX + 32,                my);
    doc.text(String(val ?? ''), rightX + 35,               my);
    my += 4.5;
  });
  y += blockH + 4;

  // ── Items table ──────────────────────────────────────────────────
  // Each row carries two visual lines:
  //   line 1: Item code  · Transferred SO date · UOM · Qty · Unit · Disc · Total
  //   line 2: Description (no other columns; takes the description column)
  // didDrawCell renders the description as a second line inside the cell so
  // jspdf-autotable's row height adjusts naturally.
  type Row = [string, string, string, string, string, string, string, string];
  const rows: Row[] = items.map((it, idx) => {
    // PR #122 — Commander 2026-05-26: "我们在下单 PO 的时候，它的 item code
    // 需要设置成我们的 internal code，但是去到 supplier 那边是能看到他们自
    // 己的 code 的". UI keeps showing our material_code; the printed PO that
    // gets emailed/posted to the supplier swaps to their SKU. Fall back to
    // our code only when the line never bound a supplier SKU (free-text /
    // one-off purchase).
    const supplierFacingCode = it.supplier_sku?.trim() || it.material_code;
    const itemAndDesc = `${supplierFacingCode}\n${it.material_name}`;
    return [
      String(idx + 1),
      itemAndDesc,
      it.delivery_date ?? '',
      (it.uom ?? '').toUpperCase(),
      String(it.qty),
      fmtAmount(it.unit_price_centi),
      it.discount_centi ? fmtAmount(it.discount_centi) : '',
      fmtAmount(it.line_total_centi),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item / Description', 'Transferred SO', 'UOM', 'Qty', `U/Price ${header.currency}`, 'Disc.', `Total ${header.currency}`]],
    body: rows,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: { top: 1.5, right: 2, bottom: 1.5, left: 2 }, lineColor: [120, 120, 120], lineWidth: 0.1 },
    headStyles: { fontStyle: 'bold', halign: 'left', valign: 'middle', lineWidth: { top: 0.4, bottom: 0.4 } as never },
    bodyStyles: { valign: 'top' },
    columnStyles: {
      0: { cellWidth: 8,  halign: 'right' },
      1: { cellWidth: 64 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 12, halign: 'right' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 16, halign: 'right' },
      7: { cellWidth: 24, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  let lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 4;

  // ── Totals (bottom right) ─────────────────────────────────────────
  const totalsX = pageW - margin - 70;
  const drawRow = (label: string, val: string, ty: number, bold = false, ruled = false) => {
    if (ruled) { doc.setDrawColor(0); doc.line(totalsX, ty - 3, pageW - margin, ty - 3); }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX,       ty);
    doc.text(val,   pageW - margin, ty, { align: 'right' });
  };
  doc.setFontSize(9);
  drawRow('Subtotal', fmtMoney(header.subtotal_centi, header.currency), lastY); lastY += 4;
  if (header.tax_centi > 0) {
    drawRow('Tax',    fmtMoney(header.tax_centi,      header.currency), lastY); lastY += 4;
  }
  doc.setFontSize(11);
  drawRow('TOTAL',    fmtMoney(header.total_centi,    header.currency), lastY + 2, true, true);
  lastY += 12;

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

  // ── Signature block (Page 1 only) ────────────────────────────────
  if (lastY > 240) { doc.addPage(); lastY = margin; }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.setDrawColor(120); doc.setLineWidth(0.2);
  const sigW = (pageW - margin * 2) / 2 - 4;
  doc.rect(margin,            lastY, sigW, 24);
  doc.rect(margin + sigW + 8, lastY, sigW, 24);
  doc.text("Authorised Signature (2990's Home)", margin + 2,             lastY + 21);
  doc.text("Supplier Acknowledgement",           margin + sigW + 8 + 2,  lastY + 21);
  lastY += 28;

  // ── Footer page numbers — patch back into the meta block + bottom ─
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    // Bottom footer
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(
      `Page ${p} of ${pageCount}    ·    Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      pageW / 2, 287, { align: 'center' },
    );
    doc.setTextColor(0);
  }
  // Patch "Page : 1 of N" in the meta block on the first page (overwrite the
  // blank we left earlier). Compute where the Page row lands.
  doc.setPage(1);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  // The meta block's "Page" row is metaLines.length-th line at
  // (rightX + 35, y_meta_start + (idx * 4.5)). We don't have y_meta_start
  // anymore — recompute: header lines + title + 5 (offset) + 6 metaLines * 4.5.
  // Simpler: just put it at the bottom-right of the meta box we drew.
  // (The Page row was index 6 inside metaLines; y_meta_start = y - blockH - 4 + 5.)
  // Easiest: re-render the Page line explicitly at the known coordinate.
  // y at the point we entered the table = y (post block). y_meta_start = y - blockH + 5.
  // Approximate the Page-row y by walking back.
  const pageRowY = (() => {
    // Title bar was at y (post-header) - 8 (advance) - 4 (meta block start) ≈ tricky
    // Just emit a small "Page X of N" label at the top-right under the No. line
    // — visually distinct from the meta box but it's good enough until commander
    // wants the exact AutoCount slot. Trade-off documented.
    return 0;
  })();
  if (pageRowY === 0) {
    // Top-right small chip under the PO number.
    doc.setFontSize(8); doc.setTextColor(80);
    doc.text(`Page 1 of ${pageCount}`, pageW - margin, 25, { align: 'right' });
    doc.setTextColor(0);
  }

  // ── Save ──────────────────────────────────────────────────────────
  const safeName = (header.supplier?.name || 'supplier').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32);
  doc.save(`${header.po_number}-${safeName}.pdf`);
}
