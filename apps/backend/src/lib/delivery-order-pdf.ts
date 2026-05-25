// ----------------------------------------------------------------------------
// Delivery Order PDF — same pattern as sales-order-pdf.ts but customer-facing
// signed POD. Driver / vehicle / delivered date prominent. Dashed signature
// box for customer to sign at delivery.
// ----------------------------------------------------------------------------

type DoHeader = {
  do_number: string;
  status: string;
  do_date: string;
  so_doc_no: string | null;
  debtor_code: string | null;
  debtor_name: string;
  expected_delivery_at: string | null;
  dispatched_at: string | null;
  signed_at: string | null;
  delivered_at: string | null;
  driver_name: string | null;
  vehicle: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  phone: string | null;
  notes: string | null;
  m3_total_milli: number | null;
};

type DoItem = {
  item_code: string;
  description: string | null;
  qty: number;
  m3_milli: number;
  unit_price_centi: number;
};

const fmtRm = (centi: number): string =>
  `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export async function generateDeliveryOrderPdf(header: DoHeader, items: DoItem[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  // Company header
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text("2990's Home", margin, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); y += 5;
  doc.text("HOOKKA Industries (Reg: 202301234567)", margin, y); y += 4;
  doc.text("Lot 12, Jalan Industri 5/3, Selangor, Malaysia", margin, y); y += 4;
  doc.text("Tel: +60 12-345-6789", margin, y);

  // Right-aligned doc info
  let rightY = margin;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text('DELIVERY ORDER', pageW - margin, rightY, { align: 'right' });
  rightY += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`DO No: ${header.do_number}`, pageW - margin, rightY, { align: 'right' }); rightY += 5;
  doc.text(`Date:  ${header.do_date}`, pageW - margin, rightY, { align: 'right' }); rightY += 5;
  if (header.so_doc_no) { doc.text(`SO Ref: ${header.so_doc_no}`, pageW - margin, rightY, { align: 'right' }); rightY += 5; }
  doc.text(`Status: ${header.status.replace(/_/g, ' ')}`, pageW - margin, rightY, { align: 'right' });

  y = Math.max(y, rightY) + 6;
  doc.setDrawColor(180); doc.line(margin, y, pageW - margin, y); y += 4;

  // Customer + delivery info
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('DELIVER TO', margin, y);
  doc.text('LOGISTICS', pageW / 2, y);
  y += 4;
  doc.setFont('helvetica', 'normal');

  const addrLine = [header.address1, header.address2, [header.postcode, header.city, header.state].filter(Boolean).join(' ')]
    .filter(Boolean).join('\n').split('\n').filter(Boolean);
  const leftLines = [
    header.debtor_name,
    header.debtor_code ? `Code: ${header.debtor_code}` : null,
    ...addrLine,
    header.phone ? `Tel: ${header.phone}` : null,
  ].filter(Boolean) as string[];

  const rightLines = [
    header.driver_name ? `Driver: ${header.driver_name}` : null,
    header.vehicle ? `Vehicle: ${header.vehicle}` : null,
    header.expected_delivery_at ? `Expected: ${header.expected_delivery_at}` : null,
    header.m3_total_milli ? `Volume: ${(header.m3_total_milli / 1000).toFixed(3)} m³` : null,
    header.notes ? `Note: ${header.notes}` : null,
  ].filter(Boolean) as string[];

  const blockTop = y;
  leftLines.forEach((l, i) => doc.text(String(l), margin, blockTop + i * 4));
  rightLines.forEach((l, i) => doc.text(String(l), pageW / 2, blockTop + i * 4));
  y = blockTop + Math.max(leftLines.length, rightLines.length) * 4 + 4;

  // Line items
  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.item_code,
    it.description ?? '—',
    String(it.qty),
    (it.m3_milli / 1000).toFixed(3),
    fmtRm(it.unit_price_centi),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item', 'Description', 'Qty', 'm³', 'Unit Price']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 30 },
      2: { cellWidth: 78 },
      3: { cellWidth: 14, halign: 'right' },
      4: { cellWidth: 18, halign: 'right' },
      5: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  // Signature blocks: customer + driver
  let ty = lastY;
  if (ty > 240) { doc.addPage(); ty = margin; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Customer Acknowledged Receipt', margin, ty);
  doc.text("2990's Home Driver Signature", pageW / 2 + 5, ty);
  ty += 2;
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setDrawColor(120);
  doc.rect(margin, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.rect(pageW / 2 + 5, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
  doc.text('Signature / Name / Date', margin + 2, ty + 26);
  doc.text('Signature / Name / Date', pageW / 2 + 7, ty + 26);
  ty += 32;

  doc.setFontSize(7.5);
  doc.text('Note: By signing above, the customer confirms receipt of the items listed in good order and condition.', margin, ty);
  doc.text(`Generated ${new Date().toLocaleString('en-MY')}`, pageW - margin, ty, { align: 'right' });

  const safeName = (header.debtor_name || 'customer').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 32);
  doc.save(`${header.do_number}-${safeName}.pdf`);
}
