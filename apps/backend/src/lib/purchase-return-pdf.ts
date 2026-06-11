// Purchase Return PDF — to send to the supplier for credit note issuance.
// Dual-code layout (Commander): supplier code first, our code alongside.
// purchase_return_items has NO supplier_sku column — resolved at print time
// from supplier_material_bindings via the doc's supplier_id.
import { drawHeader, drawTwoColInfo, drawSignatureBoxes, fmtRm, safeName, fmtDocDate } from './pdf-common';
import { loadSupplierDocData, supplierCodeFor, specsLine } from './supplier-doc-data';

type PrHeader = {
  return_number: string; status: string; return_date: string;
  reason: string | null; refund_centi: number; credit_note_ref: string | null;
  notes: string | null;
  supplier_id?: string | null;
  supplier?: { code: string; name: string };
  purchase_order?: { id: string; po_number: string };
  grn?: { id: string; grn_number: string };
};
type PrItem = {
  material_code: string; material_name: string;
  qty_returned: number; unit_price_centi: number; line_refund_centi: number;
  reason: string | null;
  /* Dual-code extras — optional so older call sites keep compiling. */
  supplier_sku?: string | null;
  item_group?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
};

export async function generatePurchaseReturnPdf(
  header: PrHeader,
  items: PrItem[],
  opts?: { docTitle?: string; docNoLabel?: string; amountLabel?: string; totalLabel?: string },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  let y = drawHeader(doc, {
    docTitle: opts?.docTitle ?? 'PURCHASE RETURN',
    rightMeta: [
      { label: opts?.docNoLabel ?? 'PR No',   value: header.return_number },
      { label: 'Date',    value: fmtDocDate(header.return_date) },
      { label: 'PO Ref',  value: header.purchase_order?.po_number ?? '—' },
      { label: 'GRN Ref', value: header.grn?.grn_number ?? '—' },
      { label: 'Status',  value: header.status },
    ],
  });

  y = drawTwoColInfo(doc, y, 'SUPPLIER', 'REASON',
    [
      header.supplier?.name ?? '—',
      header.supplier?.code ? `Code: ${header.supplier.code}` : null,
    ],
    [header.reason ?? '—', header.notes ?? null, header.credit_note_ref ? `Supplier CN: ${header.credit_note_ref}` : null],
  );

  // Codes note + dual-code lookups (no supplier_sku column on PR items —
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
      String(it.qty_returned),
      fmtRm(it.unit_price_centi),
      fmtRm(it.line_refund_centi),
      it.reason ?? '—',
    ];
  });
  autoTable(doc, {
    startY: y,
    head: [['#', 'Supplier Code', 'Our Code', 'Description', 'Qty', 'Unit Price', opts?.amountLabel ?? 'Refund', 'Reason']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 24, fontStyle: 'bold' },
      2: { cellWidth: 24 },
      3: { cellWidth: 44 },
      4: { cellWidth: 10, halign: 'right' },
      5: { cellWidth: 24, halign: 'right' },
      6: { cellWidth: 24, halign: 'right' },
      7: { cellWidth: 24 },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  // Total refund row
  const totalsX = pageW - margin - 70;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(opts?.totalLabel ?? 'TOTAL REFUND', totalsX, lastY + 2);
  doc.text(fmtRm(header.refund_centi), pageW - margin, lastY + 2, { align: 'right' });

  drawSignatureBoxes(doc, lastY + 12, "2990's Home Issued By", 'Supplier Acknowledgement');

  doc.save(`${header.return_number}-${safeName(header.supplier?.name ?? 'supplier')}.pdf`);
}
