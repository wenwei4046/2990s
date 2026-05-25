// ----------------------------------------------------------------------------
// Purchase Order PDF — to send to supplier. Company header on top, supplier
// "DELIVER TO" block, line items with our material code + supplier SKU side
// by side, total at the bottom, T&C footer.
// ----------------------------------------------------------------------------

type PoHeader = {
  po_number: string;
  status: string;
  po_date: string;
  expected_at: string | null;
  currency: string;
  subtotal_centi: number;
  tax_centi: number;
  total_centi: number;
  notes: string | null;
  supplier?: {
    code: string;
    name: string;
    contact_person?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  } | null;
};

type PoItem = {
  material_code: string;
  material_name: string;
  supplier_sku: string | null;
  qty: number;
  unit_price_centi: number;
  line_total_centi: number;
};

const fmtRm = (centi: number, currency: string): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generatePurchaseOrderPdf(header: PoHeader, items: PoItem[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  // Company header
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text("2990's Home", margin, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); y += 5;
  doc.text("HOOKKA Industries (Reg: 202301234567)", margin, y); y += 4;
  doc.text("Lot 12, Jalan Industri 5/3, Selangor, Malaysia", margin, y); y += 4;
  doc.text("Tel: +60 12-345-6789 · Email: procurement@2990s.my", margin, y);

  // Right-aligned doc info
  let rightY = margin;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('PURCHASE ORDER', pageW - margin, rightY, { align: 'right' });
  rightY += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`PO No: ${header.po_number}`, pageW - margin, rightY, { align: 'right' }); rightY += 5;
  doc.text(`Date:  ${header.po_date}`, pageW - margin, rightY, { align: 'right' }); rightY += 5;
  if (header.expected_at) {
    doc.text(`Expected: ${header.expected_at}`, pageW - margin, rightY, { align: 'right' });
    rightY += 5;
  }
  doc.text(`Status: ${header.status.replace(/_/g, ' ')}`, pageW - margin, rightY, { align: 'right' });

  y = Math.max(y, rightY) + 6;
  doc.setDrawColor(180); doc.line(margin, y, pageW - margin, y); y += 4;

  // Supplier block (left) + remark (right)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('SUPPLIER', margin, y);
  doc.text('REMARK', pageW / 2, y);
  y += 4;
  doc.setFont('helvetica', 'normal');

  const s = header.supplier;
  const supplierLines = [
    s?.name,
    s?.code ? `Code: ${s.code}` : null,
    s?.contact_person ? `Attn: ${s.contact_person}` : null,
    s?.phone ? `Tel: ${s.phone}` : null,
    s?.email ? `Email: ${s.email}` : null,
    s?.address,
  ].filter(Boolean) as string[];

  const remarkLines = (header.notes ?? '').split('\n').filter(Boolean);

  const blockTop = y;
  supplierLines.forEach((l, i) => doc.text(String(l), margin, blockTop + i * 4));
  remarkLines.forEach((l, i) => doc.text(String(l), pageW / 2, blockTop + i * 4));
  y = blockTop + Math.max(supplierLines.length, remarkLines.length, 1) * 4 + 4;

  // Line items
  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.material_code,
    it.supplier_sku ?? '—',
    it.material_name,
    String(it.qty),
    fmtRm(it.unit_price_centi, header.currency),
    fmtRm(it.line_total_centi, header.currency),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['#', 'Our Code', 'Supplier SKU', 'Description', 'Qty', 'Unit Price', 'Total']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 24 },
      2: { cellWidth: 28 },
      3: { cellWidth: 60 },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 24, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  // Totals
  const totalsX = pageW - margin - 70;
  const drawRow = (label: string, val: string, ty: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX, ty);
    doc.text(val, pageW - margin, ty, { align: 'right' });
  };
  doc.setFontSize(9);
  let ty = lastY;
  drawRow('Subtotal', fmtRm(header.subtotal_centi, header.currency), ty); ty += 4;
  drawRow('Tax',      fmtRm(header.tax_centi,      header.currency), ty); ty += 5;
  doc.setDrawColor(0); doc.line(totalsX, ty - 2, pageW - margin, ty - 2);
  doc.setFontSize(11);
  drawRow('GRAND TOTAL', fmtRm(header.total_centi, header.currency), ty + 2, true);
  ty += 12;

  // Signature block
  if (ty > 240) { doc.addPage(); ty = margin; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text("2990's Home Authorised Signature", margin, ty);
  doc.text('Supplier Acknowledgement', pageW / 2 + 5, ty);
  ty += 2;
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setDrawColor(120);
  doc.rect(margin, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.rect(pageW / 2 + 5, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.setLineDashPattern([], 0);
  ty += 28;

  // T&C footer
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
  const tc = [
    "Terms & Conditions:",
    "1. Goods must be delivered to the address registered with 2990's Home.",
    "2. Delivery notes (DN) must accompany every shipment and quote this PO number.",
    "3. Quality non-conforming items will be rejected and noted on the GRN.",
    "4. Payment terms as per agreement on supplier master record.",
  ];
  tc.forEach((line, i) => doc.text(line, margin, ty + i * 3.5));

  const safeName = (header.supplier?.name || 'supplier').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32);
  doc.save(`${header.po_number}-${safeName}.pdf`);
}
