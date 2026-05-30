// Purchase Invoice PDF — internal copy / for filing.
import { drawHeader, drawTwoColInfo, fmtRm, safeName } from './pdf-common';

type PiHeader = {
  invoice_number: string; supplier_invoice_ref: string | null; status: string;
  invoice_date: string; due_date: string | null; currency: string;
  subtotal_centi: number; tax_centi: number; total_centi: number;
  paid_centi: number; notes: string | null;
  supplier?: { code: string; name: string };
};
type PiItem = {
  material_code: string; material_name: string;
  qty: number; unit_price_centi: number; line_total_centi: number;
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
      { label: 'Date',         value: header.invoice_date },
      { label: 'Due',          value: header.due_date ?? '—' },
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

  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.material_code,
    it.material_name,
    String(it.qty),
    fmtRm(it.unit_price_centi, header.currency),
    fmtRm(it.line_total_centi, header.currency),
  ]);
  autoTable(doc, {
    startY: y,
    head: [['#', 'Code', 'Description', 'Qty', 'Unit Price', 'Total']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 26 },
      2: { cellWidth: 78 },
      3: { cellWidth: 14, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
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

  doc.save(`${header.invoice_number}-${safeName(header.supplier?.name ?? 'supplier')}.pdf`);
}
