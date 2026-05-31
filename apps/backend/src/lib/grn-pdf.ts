// Goods Receipt Note PDF — printable for warehouse / supplier reconciliation.
import { drawHeader, drawTwoColInfo, drawSignatureBoxes, fmtRm, safeName, fmtDocDate } from './pdf-common';

type GrnHeader = {
  grn_number: string; status: string;
  received_at: string; delivery_note_ref: string | null;
  notes: string | null; posted_at: string | null;
  supplier?: { code: string; name: string };
  purchase_order?: { id: string; po_number: string };
};
type GrnItem = {
  material_code: string; material_name: string;
  qty_received: number; qty_accepted: number; qty_rejected: number;
  rejection_reason: string | null; unit_price_centi: number;
};

export async function generateGrnPdf(header: GrnHeader, items: GrnItem[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  let y = drawHeader(doc, {
    docTitle: 'GOODS RECEIPT NOTE',
    rightMeta: [
      { label: 'GRN No',   value: header.grn_number },
      { label: 'Received', value: fmtDocDate(header.received_at) },
      { label: 'DN Ref',   value: header.delivery_note_ref ?? '—' },
      { label: 'PO Ref',   value: header.purchase_order?.po_number ?? '—' },
      { label: 'Status',   value: header.status },
    ],
  });

  y = drawTwoColInfo(doc, y, 'SUPPLIER', 'NOTES',
    [
      header.supplier?.name ?? '—',
      header.supplier?.code ? `Code: ${header.supplier.code}` : null,
    ],
    [header.notes ?? null, header.posted_at ? `Posted: ${header.posted_at.slice(0, 10)}` : null],
  );

  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.material_code,
    it.material_name,
    String(it.qty_received),
    String(it.qty_accepted),
    String(it.qty_rejected),
    it.rejection_reason ?? (it.qty_rejected > 0 ? '—' : ''),
    fmtRm(it.unit_price_centi),
  ]);
  autoTable(doc, {
    startY: y,
    head: [['#', 'Code', 'Description', 'Recv', 'Acc', 'Rej', 'Reason', 'Unit Price']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 24 },
      2: { cellWidth: 56 },
      3: { cellWidth: 14, halign: 'right' },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 14, halign: 'right' },
      6: { cellWidth: 32 },
      7: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  drawSignatureBoxes(doc, lastY, 'Warehouse Received By', 'Supplier Driver Signature');

  doc.save(`${header.grn_number}-${safeName(header.supplier?.name ?? 'supplier')}.pdf`);
}
