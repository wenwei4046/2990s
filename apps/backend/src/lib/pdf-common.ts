// ----------------------------------------------------------------------------
// Shared helpers for jspdf-based document PDFs. Avoids copy-pasting the
// company header / footer across SI / PI / GRN / PR / DR PDFs.
// ----------------------------------------------------------------------------

export const COMPANY = {
  name: "2990's Home",
  reg: 'HOOKKA Industries (Reg: 202301234567)',
  address: 'Lot 12, Jalan Industri 5/3, Selangor, Malaysia',
  tel: '+60 12-345-6789',
} as const;

export const fmtRm = (centi: number | null, currency = 'MYR'): string => {
  if (centi == null) return '—';
  return `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// Draw the 2990s header (top-left brand) + doc title + meta block on the right.
// Returns the y position where the body should continue.
export function drawHeader(
  doc: import('jspdf').jsPDF,
  opts: {
    docTitle: string;       // e.g. "SALES INVOICE"
    rightMeta: Array<{ label: string; value: string }>;
  },
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = margin;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(COMPANY.name, margin, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); y += 5;
  doc.text(COMPANY.reg, margin, y); y += 4;
  doc.text(COMPANY.address, margin, y); y += 4;
  doc.text(`Tel: ${COMPANY.tel}`, margin, y);

  let rightY = margin;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(opts.docTitle, pageW - margin, rightY, { align: 'right' });
  rightY += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  for (const m of opts.rightMeta) {
    doc.text(`${m.label}: ${m.value}`, pageW - margin, rightY, { align: 'right' });
    rightY += 5;
  }

  y = Math.max(y, rightY) + 6;
  doc.setDrawColor(180); doc.line(margin, y, pageW - margin, y);
  return y + 4;
}

// Two-column info block (e.g. "BILL TO" + "DETAILS")
export function drawTwoColInfo(
  doc: import('jspdf').jsPDF,
  startY: number,
  leftTitle: string,
  rightTitle: string,
  leftLines: Array<string | null | undefined>,
  rightLines: Array<string | null | undefined>,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = startY;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(leftTitle, margin, y);
  doc.text(rightTitle, pageW / 2, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  const lefts = leftLines.filter(Boolean) as string[];
  const rights = rightLines.filter(Boolean) as string[];
  const top = y;
  lefts.forEach((l, i) => doc.text(l, margin, top + i * 4));
  rights.forEach((l, i) => doc.text(l, pageW / 2, top + i * 4));
  return top + Math.max(lefts.length, rights.length, 1) * 4 + 4;
}

// Two dashed signature boxes side by side
export function drawSignatureBoxes(
  doc: import('jspdf').jsPDF,
  startY: number,
  leftLabel: string,
  rightLabel: string,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let ty = startY;
  if (ty > 240) { doc.addPage(); ty = margin; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text(leftLabel, margin, ty);
  doc.text(rightLabel, pageW / 2 + 5, ty);
  ty += 2;
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.setDrawColor(120);
  doc.rect(margin, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.rect(pageW / 2 + 5, ty, (pageW - margin * 2) / 2 - 5, 22);
  doc.setLineDashPattern([], 0);
  return ty + 28;
}

// Safe filename: keep alphanum + - and _
export const safeName = (s: string, maxLen = 32): string =>
  (s || 'doc').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, maxLen);
