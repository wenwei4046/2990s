// Delivery Return PDF — printable for the customer to sign on collection.
import { drawHeader, drawTwoColInfo, drawSignatureBoxes, fmtRm, safeName } from './pdf-common';

type DrHeader = {
  return_number: string; status: string; return_date: string;
  debtor_code: string | null; debtor_name: string;
  reason: string | null; refund_centi: number; notes: string | null;
  delivery_order_id: string | null; sales_invoice_id: string | null;
};
type DrItem = {
  item_code: string; description: string | null;
  qty_returned: number; condition: string | null;
  unit_price_centi: number; refund_centi: number;
};

export async function generateDeliveryReturnPdf(header: DrHeader, items: DrItem[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  let y = drawHeader(doc, {
    docTitle: 'DELIVERY RETURN',
    rightMeta: [
      { label: 'DR No',  value: header.return_number },
      { label: 'Date',   value: header.return_date },
      { label: 'Status', value: header.status },
    ],
  });

  y = drawTwoColInfo(doc, y, 'FROM CUSTOMER', 'REASON',
    [
      header.debtor_name,
      header.debtor_code ? `Code: ${header.debtor_code}` : null,
    ],
    [header.reason ?? '—', header.notes ?? null],
  );

  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.item_code,
    it.description ?? '—',
    String(it.qty_returned),
    it.condition ?? '—',
    fmtRm(it.unit_price_centi),
    fmtRm(it.refund_centi),
  ]);
  autoTable(doc, {
    startY: y,
    head: [['#', 'Item', 'Description', 'Qty', 'Condition', 'Unit Price', 'Refund']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 24 },
      2: { cellWidth: 60 },
      3: { cellWidth: 14, halign: 'right' },
      4: { cellWidth: 22 },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 26, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  const totalsX = pageW - margin - 70;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('TOTAL REFUND', totalsX, lastY + 2);
  doc.text(fmtRm(header.refund_centi), pageW - margin, lastY + 2, { align: 'right' });

  drawSignatureBoxes(doc, lastY + 12, 'Customer Confirms Return', "2990's Home Received By");

  doc.save(`${header.return_number}-${safeName(header.debtor_name)}.pdf`);
}
