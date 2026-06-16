// ----------------------------------------------------------------------------
// Delivery Order PDF — same pattern as sales-order-pdf.ts but customer-facing
// signed POD. Driver / vehicle / delivered date prominent. Dashed signature
// box for customer to sign at delivery.
// ----------------------------------------------------------------------------

import {
  drawHeader,
  drawTwoColInfo,
  drawSignatureBoxes,
  fmtDocDate,
  fmtDocStamp,
  fmtRm,
  safeName,
} from './pdf-common';
import { docVariantLine, loadCustomerFabricMaps } from './supplier-doc-data';

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
  m3_milli: number | null;
  unit_price_centi: number;
  /* Variant info snapshotted from the SO (migration 0058) — drives the unified
     variant line so DO/Consignment Note read like SO/PO/etc. */
  item_group?: string | null;
  variants?: Record<string, unknown> | null;
};

export async function generateDeliveryOrderPdf(
  header: DoHeader,
  items: DoItem[],
  opts?: { docTitle?: string; docNoLabel?: string },
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;

  // ── Header (shared pdf-common layout) ─────────────────────────────
  let y = drawHeader(doc, {
    docTitle: opts?.docTitle ?? 'DELIVERY ORDER',
    rightMeta: [
      { label: opts?.docNoLabel ?? 'DO No', value: header.do_number },
      { label: 'Date', value: fmtDocDate(header.do_date) },
      ...(header.so_doc_no ? [{ label: 'SO Ref', value: header.so_doc_no }] : []),
      { label: 'Status', value: header.status.replace(/_/g, ' ') },
    ],
  });

  // ── Customer + delivery (driver / vehicle) info ──────────────────
  const addrLine = [header.address1, header.address2, [header.postcode, header.city, header.state].filter(Boolean).join(' ')]
    .filter(Boolean).join('\n').split('\n').filter(Boolean);
  y = drawTwoColInfo(doc, y, 'DELIVER TO', 'LOGISTICS',
    [
      header.debtor_name,
      header.debtor_code ? `Code: ${header.debtor_code}` : null,
      ...addrLine,
      header.phone ? `Tel: ${header.phone}` : null,
    ],
    [
      header.driver_name ? `Driver: ${header.driver_name}` : null,
      header.vehicle ? `Vehicle: ${header.vehicle}` : null,
      header.expected_delivery_at ? `Expected: ${fmtDocDate(header.expected_delivery_at)}` : null,
      header.m3_total_milli ? `Volume: ${(header.m3_total_milli / 1000).toFixed(3)} m³` : null,
      header.notes ? `Note: ${header.notes}` : null,
    ],
  );

  // Line items — description cell = SKU description + the UNIFIED variant line
  // (same composer as SO/DR/SI/consignment), so the line reads identically on
  // every customer document (Commander 2026-06-16).
  const fabric = await loadCustomerFabricMaps(items);
  const rows = items.map((it, idx) => [
    String(idx + 1),
    it.item_code,
    [it.description, docVariantLine(it, fabric.ext, fabric.desc)].filter(Boolean).join('\n') || '—',
    String(it.qty),
    it.m3_milli != null ? (it.m3_milli / 1000).toFixed(3) : '—',
    fmtRm(it.unit_price_centi),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['#', 'Item', 'Description', 'Qty', 'm³', 'Unit Price']],
    body: rows,
    theme: 'striped',
    styles: { fontSize: 8.5, cellPadding: 2 },
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

  // Signature blocks: customer + driver (shared pdf-common layout)
  const ty = drawSignatureBoxes(doc, lastY, 'Customer Acknowledged Receipt', "2990's Home Driver Signature");

  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
  doc.text('Note: By signing above, the customer confirms receipt of the items listed in good order and condition.', margin, ty);
  doc.text(`Generated ${fmtDocStamp()}`, pageW - margin, ty, { align: 'right' });

  doc.save(`${header.do_number}-${safeName(header.debtor_name || 'customer')}.pdf`);
}
