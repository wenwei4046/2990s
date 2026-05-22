import { describe, it, expect } from 'vitest';
import { exportCsv, type AuditExportRow } from './audit-export';

const sampleRows: AuditExportRow[] = [
  {
    id: 'SO-2990',
    placedAt: '2026-05-22T10:14:00Z',
    showroomName: 'Showroom KL',
    customerName: 'Tan Wei Ming',
    total: 5980,
    paymentMethod: 'transfer',
    approvalCode: 'BNK-784512',
    salespersonName: 'Aw Wei Lin',
    keyedByName: 'Aw Wei Lin',
    slipUploaded: true,
  },
  {
    id: 'SO-2991',
    placedAt: '2026-05-22T11:30:00Z',
    showroomName: 'Showroom KL',
    customerName: 'Lim Mei Ling, "VIP"',
    total: 12500,
    paymentMethod: 'credit',
    approvalCode: null,
    salespersonName: 'Jeff Mok',
    keyedByName: 'Jeff Mok',
    slipUploaded: false,
  },
];

describe('exportCsv', () => {
  it('produces a UTF-8 BOM + header row + escaped data rows', () => {
    const csv = exportCsv(sampleRows);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toMatch(/SO#,Date,Showroom,Customer,Amount \(RM\),Method,Approval code,Salesperson,Keyed by,Slip uploaded/);
    expect(csv).toContain('"Lim Mei Ling, ""VIP"""');
    expect(csv).not.toMatch(/null/i);
    expect(csv).toMatch(/Yes/);
    expect(csv).toMatch(/No/);
  });

  it('returns just BOM + header when no rows', () => {
    const csv = exportCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    const lines = csv.slice(1).split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
  });
});

describe('exportXlsx', () => {
  it('produces a non-empty Uint8Array', async () => {
    const { exportXlsx } = await import('./audit-export');
    const bytes = await exportXlsx(sampleRows);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
  });

  it('embeds a sheet named "Payments"', async () => {
    const { exportXlsx } = await import('./audit-export');
    const XLSX = await import('xlsx');
    const bytes = await exportXlsx(sampleRows);
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toContain('Payments');
    const sheet = wb.Sheets['Payments'];
    expect(sheet['A1'].v).toBe('SO#');
    expect(sheet['E1'].v).toBe('Amount (RM)');
    expect(sheet['A2'].v).toBe('SO-2990');
    expect(typeof sheet['E2'].v).toBe('number');
    expect(sheet['E2'].v).toBe(5980);
  });
});
