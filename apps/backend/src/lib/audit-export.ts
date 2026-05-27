export interface AuditExportRow {
  id: string;
  placedAt: string;
  showroomName: string;
  customerName: string;
  total: number;
  paid: number;
  paymentMethod: string;
  merchantProvider: string | null;
  installmentMonths: number | null;
  approvalCode: string | null;
  salespersonName: string;
  keyedByName: string;
  slipUploaded: boolean;
}

const HEADERS = [
  'SO#', 'Date', 'Showroom', 'Customer',
  'Amount (RM)', 'Paid (RM)', 'Method', 'Merchant', 'Installment (months)',
  'Approval code', 'Salesperson', 'Keyed by', 'Slip uploaded',
] as const;

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mm = months[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd} ${mm} ${yyyy} ${hh}:${min}`;
};

const csvEscape = (cell: string | number | null | undefined): string => {
  if (cell === null || cell === undefined) return '';
  const s = String(cell);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

export function exportCsv(rows: AuditExportRow[]): string {
  const lines: string[] = [HEADERS.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.id),
      csvEscape(fmtDate(r.placedAt)),
      csvEscape(r.showroomName),
      csvEscape(r.customerName),
      csvEscape(r.total),
      csvEscape(r.paid),
      csvEscape(r.paymentMethod),
      csvEscape(r.merchantProvider ?? ''),
      csvEscape(r.installmentMonths ?? ''),
      csvEscape(r.approvalCode),
      csvEscape(r.salespersonName),
      csvEscape(r.keyedByName),
      csvEscape(r.slipUploaded ? 'Yes' : 'No'),
    ].join(','));
  }
  return '﻿' + lines.join('\n');
}

export async function exportXlsx(rows: AuditExportRow[]): Promise<Uint8Array> {
  const XLSX = await import('xlsx');

  const data: (string | number)[][] = [HEADERS.slice()];
  for (const r of rows) {
    data.push([
      r.id, fmtDate(r.placedAt), r.showroomName, r.customerName,
      r.total, r.paid, r.paymentMethod, r.merchantProvider ?? '', r.installmentMonths ?? '',
      r.approvalCode ?? '', r.salespersonName, r.keyedByName,
      r.slipUploaded ? 'Yes' : 'No',
    ]);
  }

  // xlsx exposes sheet-meta props (!cols, !freeze) as bracket-indexed keys
  // typed as `unknown` in the base WorkSheet shape. Narrow once via an
  // intersection rather than spraying `as any` on every assignment.
  type WsMeta = {
    '!cols'?: { wch: number }[];
    '!freeze'?: { xSplit: number; ySplit: number };
  };
  const ws = XLSX.utils.aoa_to_sheet(data) as ReturnType<typeof XLSX.utils.aoa_to_sheet> & WsMeta;
  ws['!cols'] = [
    { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 18 },
    { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
  ];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Payments');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(buf as ArrayBuffer);
}

export function downloadBlob(bytes: Uint8Array | string, filename: string, mime: string): void {
  const blob = typeof bytes === 'string'
    ? new Blob([bytes], { type: mime })
    : new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
