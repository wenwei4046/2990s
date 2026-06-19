// Goods Receipt Note PDF — printable for warehouse / supplier reconciliation.
// Dual-code layout (Commander): supplier sees THEIR code first, ours alongside;
// fabric specs show the supplier's colour code with our internal code in ().
//
// 2026-06-19 — adopts the unified "Hookka-tidy" layout shared with SO/PO/DO/SI:
// real letterhead header, the drawInfoColumns info block (SUPPLIER label-gutter +
// GRN DETAILS colon-aligned), and the consistent footer (doc no · portal · page
// n of m) on every page. A4 portrait, pure B&W. No field dropped.
import { COMPANY, drawHeader, drawInfoColumns, drawSignatureBoxes, fmtRm, safeName, fmtDocDate } from './pdf-common';
import { loadSupplierDocData, supplierCodeFor, specsLine } from './supplier-doc-data';

type GrnHeader = {
  grn_number: string; status: string;
  received_at: string; delivery_note_ref: string | null;
  notes: string | null; posted_at: string | null;
  supplier_id?: string | null;
  supplier?: { code: string; name: string };
  purchase_order?: { id: string; po_number: string };
};
type GrnItem = {
  material_code: string; material_name: string;
  qty_received: number; qty_accepted: number; qty_rejected: number;
  rejection_reason: string | null; unit_price_centi: number;
  /* Dual-code extras — all optional so older call sites keep compiling. */
  supplier_sku?: string | null;
  item_group?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
};

export async function generateGrnPdf(
  header: GrnHeader,
  items: GrnItem[],
  opts?: { docTitle?: string; docNoLabel?: string },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  let y = drawHeader(doc, {
    docTitle: opts?.docTitle ?? 'GOODS RECEIPT NOTE',
    rightMeta: [
      { label: opts?.docNoLabel ?? 'GRN No', value: header.grn_number },
      { label: 'Date', value: fmtDocDate(header.received_at) },
    ],
  });

  const statusText = header.status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  y = drawInfoColumns(doc, y,
    {
      title: 'SUPPLIER',
      rows: [
        ['Company', header.supplier?.name ?? null],
        ['Code', header.supplier?.code ?? null],
        ['Note', header.notes],
      ],
    },
    {
      title: 'GRN DETAILS',
      rows: [
        [opts?.docNoLabel ?? 'GRN No', header.grn_number],
        ['Received', fmtDocDate(header.received_at)],
        ['DN Ref', header.delivery_note_ref],
        ['PO Ref', header.purchase_order?.po_number],
        ['Posted', header.posted_at ? fmtDocDate(header.posted_at) : null],
        ['Status', statusText],
      ],
    },
  );

  // Codes note + dual-code lookups (snapshotted grn_items.supplier_sku first,
  // live binding fallback; fabric specs mapped via fabric_trackings).
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
      String(it.qty_received),
      String(it.qty_accepted),
      String(it.qty_rejected),
      it.rejection_reason ?? (it.qty_rejected > 0 ? '—' : ''),
      fmtRm(it.unit_price_centi),
    ];
  });
  autoTable(doc, {
    startY: y,
    head: [['#', 'Supplier Code', 'Our Code', 'Description', 'Recv', 'Acc', 'Rej', 'Reason', 'Unit Price']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2, valign: 'top' },
    headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 8, halign: 'right' },
      1: { cellWidth: 24, fontStyle: 'bold' },
      2: { cellWidth: 24 },
      3: { cellWidth: 47 },
      4: { cellWidth: 11, halign: 'right' },
      5: { cellWidth: 11, halign: 'right' },
      6: { cellWidth: 11, halign: 'right' },
      7: { cellWidth: 24 },
      8: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
  const lastY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;

  drawSignatureBoxes(doc, lastY, 'Warehouse Received By', 'Supplier Driver Signature');

  // Footer: doc no · portal · page n of m on every page
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
    doc.text(header.grn_number, margin, 290);
    doc.text(`${COMPANY.portalLabel} · ${fmtDocDate(header.received_at)}`, pageW / 2, 290, { align: 'center' });
    doc.text(`Page ${p} of ${pageCount}`, pageW - margin, 290, { align: 'right' });
    doc.setTextColor(0);
  }

  doc.save(`${header.grn_number}-${safeName(header.supplier?.name ?? 'supplier')}.pdf`);
}
