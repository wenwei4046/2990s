// ----------------------------------------------------------------------------
// Sales Order PDF generator — dynamic jspdf import so it doesn't bloat the
// main bundle. ~430 kB on its own (gzipped 143 kB); rendered into a vendor
// chunk by Vite's automatic chunk-splitter.
//
// Layout (A4 portrait):
//   1. Header: company name + reg + address (left), SO no / date / status (right)
//   2. Customer block: debtor info + 4 addresses
//   3. Line items table (autotable): item / variants / qty / unit / total
//   4. Totals block: per-category + grand total
//   5. Payments block (PR #163 / Followup #81): payments-ledger transactions
//      table + paid/balance summary. Replaces the legacy single-row header
//      payment fields (paid_centi, payment_method, merchant_provider,
//      approval_code, payment_date) which were deprecated in PR-C when the
//      payments ledger went live.
//   6. Signature box (customer + company) — dashed boxes, matches POS PDFs
//   7. Footer: T&C, page n of m
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
};

type SoItem = {
  id: string;
  item_group: string;
  item_code: string;
  description: string | null;
  uom: string;
  qty: number;
  unit_price_centi: number;
  discount_centi: number;
  total_centi: number;
  variants: Record<string, unknown> | null;
};

/* Mirrors flow-queries.ts `SoPayment`. Re-declared here to keep the PDF
   helper free of TanStack/Supabase imports — it's called from both the
   detail page (where the hook supplies the data) and the list page (where
   a one-shot fetch supplies it). Fields the PDF doesn't render are still
   accepted so callers can pass the row verbatim. */
type SoPayment = {
  paid_at: string;
  method: 'merchant' | 'transfer' | 'cash';
  merchant_provider: 'GHL' | 'HLB' | 'MBB' | 'PBB' | null;
  installment_months: 6 | 12 | null;
  approval_code: string | null;
  amount_centi: number;
  account_sheet: string | null;
  collected_by_name: string | null;
  note: string | null;
};

const fmtRm = (centi: number, currency: string): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

const variantSummary = (v: Record<string, unknown> | null): string => {
  if (!v) return '';
  return Object.entries(v)
    .filter(([, val]) => val != null && val !== '')
    .map(([k, val]) => `${k}: ${val}`)
    .join(', ');
};

/* Human-readable method label for the PDF Payments table.
   - merchant → "Card (GHL)" or "Card (GHL) · 6m installment"
   - transfer → "Bank Transfer"
   - cash     → "Cash"
   Mirrors the on-screen METHOD_LABEL + provider/installment pill in
   SalesOrderDetail's PaymentCard but flattened to a single cell. */
const methodLabel = (p: SoPayment): string => {
  if (p.method === 'merchant') {
    const base = p.merchant_provider ? `Card (${p.merchant_provider})` : 'Card';
    return p.installment_months ? `${base} · ${p.installment_months}m installment` : base;
  }
  if (p.method === 'transfer') return 'Bank Transfer';
  return 'Cash';
};

export async function generateSalesOrderPdf(
  header: SoHeader,
  items: SoItem[],
  payments: SoPayment[] = [],
): Promise<void> {
  // Dynamic import — code-split into a vendor chunk.
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  // ── Header ────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text("2990's Home", margin, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  y += 5;
  doc.text("HOOKKA Industries (Reg: 202301234567)", margin, y);
  y += 4;
  doc.text("Lot 12, Jalan Industri 5/3, Selangor, Malaysia", margin, y);
  y += 4;
  doc.text("Tel: +60 12-345-6789 · Email: hello@2990s.my", margin, y);

  // Doc info — right aligned
  let rightY = margin;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('SALES ORDER', pageW - margin, rightY, { align: 'right' });
  rightY += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Doc No: ${header.doc_no}`, pageW - margin, rightY, { align: 'right' });
  rightY += 5;
  doc.text(`Date:   ${header.so_date}`, pageW - margin, rightY, { align: 'right' });
  rightY += 5;
  doc.text(`Status: ${header.status.replace(/_/g, ' ')}`, pageW - margin, rightY, { align: 'right' });

  y = Math.max(y, rightY) + 6;

  // ── Customer block ───────────────────────────────────────────────
  doc.setDrawColor(180);
  doc.line(margin, y, pageW - margin, y);
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('BILL TO', margin, y);
  doc.text('DETAILS', pageW / 2, y);
  y += 4;
  doc.setFont('helvetica', 'normal');

  const leftLines = [
    header.debtor_name,
    header.debtor_code ? `Code: ${header.debtor_code}` : null,
    header.address1,
    header.address2,
    header.address3,
    header.address4,
    header.phone ? `Tel: ${header.phone}` : null,
  ].filter(Boolean) as string[];

  const rightLines = [
    header.agent ? `Agent: ${header.agent}` : null,
    header.branding ? `Branding: ${header.branding}` : null,
    header.venue ? `Venue: ${header.venue}` : null,
    header.ref ? `Reference: ${header.ref}` : null,
    header.po_doc_no ? `Customer PO: ${header.po_doc_no}` : null,
    header.note ? `Note: ${header.note}` : null,
  ].filter(Boolean) as string[];

  const blockTop = y;
  leftLines.forEach((line, i) => {
    doc.text(String(line), margin, blockTop + i * 4);
  });
  rightLines.forEach((line, i) => {
    doc.text(String(line), pageW / 2, blockTop + i * 4);
  });
  y = blockTop + Math.max(leftLines.length, rightLines.length) * 4 + 4;

  // ── Line items table ─────────────────────────────────────────────
  const tableRows = items.map((it, idx) => {
    const vs = variantSummary(it.variants);
    const desc = [it.description, vs].filter(Boolean).join('\n');
    return [
      String(idx + 1),
      it.item_code,
      desc,
      it.item_group.toUpperCase(),
      String(it.qty) + ' ' + it.uom,
      fmtRm(it.unit_price_centi, header.currency),
      it.discount_centi > 0 ? fmtRm(it.discount_centi, header.currency) : '—',
      fmtRm(it.total_centi, header.currency),
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item', 'Description', 'Group', 'Qty', 'Unit', 'Disc', 'Total']],
    body: tableRows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 22 },
      2: { cellWidth: 65 },
      3: { cellWidth: 18 },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 18, halign: 'right' },
      7: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  // jspdf-autotable mutates doc by writing __lastAutoTable_finalY into internals.
  // Read it off the typed (any) shim so we know where to continue drawing.
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 4;

  // ── Totals ────────────────────────────────────────────────────────
  const totalsX = pageW - margin - 70;
  doc.setFontSize(9);
  const drawRow = (label: string, val: string, ty: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX, ty);
    doc.text(val, pageW - margin, ty, { align: 'right' });
  };
  let ty = lastY;
  drawRow('Mattress / Sofa', fmtRm(header.mattress_sofa_centi, header.currency), ty); ty += 4;
  drawRow('Bedframe',        fmtRm(header.bedframe_centi,       header.currency), ty); ty += 4;
  drawRow('Accessories',     fmtRm(header.accessories_centi,    header.currency), ty); ty += 4;
  drawRow('Others',          fmtRm(header.others_centi,         header.currency), ty); ty += 5;
  doc.setDrawColor(0);
  doc.line(totalsX, ty - 2, pageW - margin, ty - 2);
  doc.setFontSize(11);
  drawRow('GRAND TOTAL', fmtRm(header.local_total_centi, header.currency), ty + 2, true);
  ty += 12;

  // ── Payments block (PR #163 / Followup #81) ──────────────────────
  // Sources transactions from the payments ledger (mfg_sales_order_payments)
  // instead of the legacy single-row header columns.
  //
  // Layout:
  //   - "Payments" sub-heading
  //   - Either a transactions table (Date · Method · Amount · Approval Code
  //     · Collected By) or an empty-state line
  //   - Summary line: Subtotal · Paid · Balance, plus the expected deposit
  //     target on the header when set.
  if (ty > 255) { doc.addPage(); ty = margin; }
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Payments', margin, ty);
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
      p.paid_at,
      methodLabel(p),
      fmtRm(p.amount_centi, header.currency),
      p.approval_code ?? '—',
      p.collected_by_name ?? '—',
    ]);
    autoTable(doc, {
      startY: ty,
      head: [['Date', 'Method', 'Amount', 'Approval Code', 'Collected By']],
      body: payRows,
      theme: 'striped',
      styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 55 },
        2: { cellWidth: 28, halign: 'right' },
        3: { cellWidth: 32 },
        4: { cellWidth: 'auto' },
      },
      margin: { left: margin, right: margin },
    });
    ty = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? ty) + 4;
  }

  // Summary line: Subtotal · Paid · Balance.
  const paidCenti = payments.reduce((sum, p) => sum + (p.amount_centi || 0), 0);
  const subtotalCenti = header.local_total_centi;
  const balanceCenti = Math.max(0, subtotalCenti - paidCenti);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const summaryParts = [
    `Subtotal: ${fmtRm(subtotalCenti, header.currency)}`,
    `Paid: ${fmtRm(paidCenti, header.currency)}`,
    `Balance: ${fmtRm(balanceCenti, header.currency)}`,
  ];
  doc.text(summaryParts.join('  ·  '), margin, ty);
  ty += 4;

  // Expected-deposit line — only shown when the commander has set one
  // on the header. Keeps the "target vs. collected" distinction visible.
  if ((header.deposit_centi ?? 0) > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(110);
    doc.text(
      `Expected deposit: ${fmtRm(header.deposit_centi ?? 0, header.currency)}`,
      margin, ty,
    );
    doc.setTextColor(0);
    ty += 4;
  }
  ty += 4;

  // ── Signature boxes ──────────────────────────────────────────────
  if (ty > 240) { doc.addPage(); ty = margin; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Customer Signature', margin, ty);
  doc.text("2990's Home Authorised Signature", pageW / 2 + 5, ty);
  ty += 2;
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setDrawColor(120);
  doc.rect(margin, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.rect(pageW / 2 + 5, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.setLineDashPattern([], 0);
  ty += 28;

  // ── T&C footer ────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  const tc = [
    "Terms & Conditions:",
    "1. All goods sold are not refundable. Returns subject to approval.",
    "2. Goods remain property of 2990's Home until full payment received.",
    "3. Customer acknowledges items received in good condition unless noted above.",
    "4. Standard 12-month manufacturer warranty applies. Excludes wear-and-tear.",
  ];
  tc.forEach((line, i) => {
    doc.text(line, margin, ty + i * 3.5);
  });

  // Filename: SO-009001-DebtorName.pdf
  const safeName = (header.debtor_name || 'customer').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32);
  doc.save(`${header.doc_no}-${safeName}.pdf`);
}
