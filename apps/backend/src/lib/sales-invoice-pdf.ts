// Sales Invoice PDF — issued to the customer.
import { drawHeader, drawTwoColInfo, drawSignatureBoxes, fmtRm, safeName, fmtDocDate, fmtDocStamp } from './pdf-common';

type SiHeader = {
  invoice_number: string; status: string;
  so_doc_no: string | null; debtor_code: string | null; debtor_name: string;
  invoice_date: string; due_date: string | null; currency: string;
  subtotal_centi: number; discount_centi: number; tax_centi: number;
  total_centi: number; paid_centi: number; notes: string | null;
};
type SiItem = {
  item_code: string; description: string | null;
  qty: number; unit_price_centi: number;
  // Older items table rows in 2990s may omit these — keep optional so the
  // detail-page items shape is assignable without forcing a schema-wide
  // type widening.
  discount_centi?: number; tax_centi?: number;
  line_total_centi: number;
};

export async function generateSalesInvoicePdf(header: SiHeader, items: SiItem[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  let y = drawHeader(doc, {
    docTitle: 'SALES INVOICE',
    rightMeta: [
      { label: 'Invoice No', value: header.invoice_number },
      { label: 'Date',       value: fmtDocDate(header.invoice_date) },
      { label: 'Due',        value: fmtDocDate(header.due_date) },
      { label: 'SO Ref',     value: header.so_doc_no ?? '—' },
      { label: 'Status',     value: header.status.replace(/_/g, ' ') },
    ],
  });

  y = drawTwoColInfo(doc, y, 'BILL TO', 'NOTES',
    [
      header.debtor_name,
      header.debtor_code ? `Code: ${header.debtor_code}` : null,
    ],
    [header.notes ?? null],
  );

  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.item_code,
    it.description ?? '—',
    String(it.qty),
    fmtRm(it.unit_price_centi, header.currency),
    (it.discount_centi ?? 0) > 0 ? fmtRm(it.discount_centi ?? 0, header.currency) : '—',
    fmtRm(it.line_total_centi, header.currency),
  ]);
  autoTable(doc, {
    startY: y,
    head: [['#', 'Item', 'Description', 'Qty', 'Unit Price', 'Disc', 'Total']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 24 },
      2: { cellWidth: 68 },
      3: { cellWidth: 14, halign: 'right' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 18, halign: 'right' },
      6: { cellWidth: 26, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  // Totals + payment
  const totalsX = pageW - margin - 70;
  const drawRow = (label: string, val: string, ty: number, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(label, totalsX, ty);
    doc.text(val, pageW - margin, ty, { align: 'right' });
  };
  doc.setFontSize(9);
  let ty = lastY;
  drawRow('Subtotal', fmtRm(header.subtotal_centi, header.currency), ty); ty += 4;
  drawRow('Discount', fmtRm(header.discount_centi, header.currency), ty); ty += 4;
  drawRow('Tax',      fmtRm(header.tax_centi,      header.currency), ty); ty += 5;
  doc.setDrawColor(0); doc.line(totalsX, ty - 2, pageW - margin, ty - 2);
  doc.setFontSize(11);
  drawRow('GRAND TOTAL', fmtRm(header.total_centi, header.currency), ty + 2, true);
  ty += 6;
  doc.setFontSize(9);
  drawRow('Paid',        fmtRm(header.paid_centi, header.currency), ty + 4); ty += 4;
  drawRow('Outstanding', fmtRm(header.total_centi - header.paid_centi, header.currency), ty + 4, true);
  ty += 12;

  ty = drawSignatureBoxes(doc, ty, 'Customer Acknowledgement', "2990's Home Authorised Signature");

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
  doc.text('Terms: Payment due as per invoice. Late payments may incur a service charge.', margin, ty);
  doc.text(`Generated ${fmtDocStamp()}`, pageW - margin, ty, { align: 'right' });

  doc.save(`${header.invoice_number}-${safeName(header.debtor_name)}.pdf`);
}
