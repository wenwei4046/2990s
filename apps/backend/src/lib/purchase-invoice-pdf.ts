// Purchase Invoice PDF — internal copy / for filing.
// Dual-code layout (Commander): supplier code first, our code alongside.
// purchase_invoice_items has NO supplier_sku column — resolved at print time
// from supplier_material_bindings via the doc's supplier_id.
import { drawHeader, drawTwoColInfo, fmtRm, safeName, fmtDocDate, fmtDocStamp } from './pdf-common';
import { loadSupplierDocData, supplierCodeFor, specsLine } from './supplier-doc-data';

type PiHeader = {
  invoice_number: string; supplier_invoice_ref: string | null; status: string;
  invoice_date: string; due_date: string | null; currency: string;
  subtotal_centi: number; tax_centi: number; total_centi: number;
  paid_centi: number; notes: string | null;
  supplier_id?: string | null;
  supplier?: { code: string; name: string };
};
type PiItem = {
  material_code: string; material_name: string;
  qty: number; unit_price_centi: number; line_total_centi: number;
  /* Dual-code extras — optional so older call sites keep compiling. */
  supplier_sku?: string | null;
  item_group?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
};

export async function generatePurchaseInvoicePdf(header: PiHeader, items: PiItem[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  let y = drawHeader(doc, {
    docTitle: 'PURCHASE INVOICE',
    rightMeta: [
      { label: 'Our PI No',    value: header.invoice_number },
      { label: 'Supplier Ref', value: header.supplier_invoice_ref ?? '—' },
      { label: 'Date',         value: fmtDocDate(header.invoice_date) },
      { label: 'Due',          value: fmtDocDate(header.due_date) },
      { label: 'Status',       value: header.status.replace(/_/g, ' ') },
    ],
  });

  y = drawTwoColInfo(doc, y, 'SUPPLIER', 'NOTES',
    [
      header.supplier?.name ?? '—',
      header.supplier?.code ? `Code: ${header.supplier.code}` : null,
    ],
    [header.notes ?? null],
  );

  // Codes note + dual-code lookups (no supplier_sku column on PI items —
  // resolved live from the supplier's bindings; fabric via fabric_trackings).
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(80);
  doc.text('Codes shown are SUPPLIER codes; our reference in second column.', margin, y);
  doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
  y += 4;
  const { skuMap, fabricMap } = await loadSupplierDocData(header.supplier_id, items);

  const rows = items.map((it, idx) => {
    const specs = specsLine(it, fabricMap);
    const desc = it.description ?? it.material_name;
    return [
      String(idx + 1),
      supplierCodeFor(it, skuMap),
      it.material_code,
      specs ? `${desc}\n${specs}` : desc,
      String(it.qty),
      fmtRm(it.unit_price_centi, header.currency),
      fmtRm(it.line_total_centi, header.currency),
    ];
  });
  autoTable(doc, {
    startY: y,
    head: [['#', 'Supplier Code', 'Our Code', 'Description', 'Qty', 'Unit Price', 'Total']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 26, fontStyle: 'bold' },
      2: { cellWidth: 26 },
      3: { cellWidth: 56 },
      4: { cellWidth: 12, halign: 'right' },
      5: { cellWidth: 27, halign: 'right' },
      6: { cellWidth: 27, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

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
  drawRow('GRAND TOTAL', fmtRm(header.total_centi, header.currency), ty + 2, true); ty += 6;
  doc.setFontSize(9);
  drawRow('Paid',        fmtRm(header.paid_centi, header.currency), ty + 4); ty += 4;
  drawRow('Outstanding', fmtRm(header.total_centi - header.paid_centi, header.currency), ty + 4, true);

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
  doc.text(`Generated ${fmtDocStamp()}`, pageW - margin, ty + 14, { align: 'right' });
  doc.setTextColor(0);

  doc.save(`${header.invoice_number}-${safeName(header.supplier?.name ?? 'supplier')}.pdf`);
}
