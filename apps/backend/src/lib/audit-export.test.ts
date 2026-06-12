import { describe, it, expect } from 'vitest';
import { exportCsv, type AuditExportRow } from './audit-export';

const sampleRows: AuditExportRow[] = [
  {
    docNo: 'SO-2606-001',
    placedAt: '2026-06-11T10:14:00Z',
    paidAt: '2026-06-11',
    venueName: 'Showroom KL',
    customerName: 'Tan Wei Ming',
    total: 5980,
    paid: 5980,
    isDeposit: false,
    paymentMethod: 'transfer',
    merchantProvider: null,
    installmentMonths: null,
    approvalCode: 'BNK-784512',
    salespersonName: 'Aw Wei Lin',
    keyedByName: 'Aw Wei Lin',
    slipUploaded: true,
  },
  {
    docNo: 'SO-2606-002',
    placedAt: '2026-06-11T11:30:00Z',
    paidAt: '2026-06-11',
    venueName: 'Showroom KL',
    customerName: 'Lim Mei Ling, "VIP"',
    total: 12500,
    paid: 3000,
    isDeposit: true,
    paymentMethod: 'merchant',
    merchantProvider: 'GHL',
    installmentMonths: null,
    approvalCode: null,
    salespersonName: 'Jeff Mok',
    keyedByName: 'Jeff Mok',
    slipUploaded: false,
  },
];

const row: AuditExportRow = {
  docNo: 'SO-2057', placedAt: '2026-05-21T15:01:00Z', paidAt: '2026-05-21',
  venueName: 'Showroom KL',
  customerName: 'Hafiz Rahman', total: 6819, paid: 4466, isDeposit: false,
  paymentMethod: 'installment', merchantProvider: null, installmentMonths: 12, approvalCode: 'CONTRACT-1',
  salespersonName: 'Rafiq Lim', keyedByName: 'Mei Lin Chua', slipUploaded: false,
};

describe('exportCsv columns', () => {
  it('includes Paid (RM), Paid date and Installment (months) headers', () => {
    const header = exportCsv([]).replace(/^﻿/, '').split('\n')[0]!;
    expect(header).toContain('Paid (RM)');
    expect(header).toContain('Paid date');
    expect(header).toContain('Installment (months)');
  });
  it('writes the paid amount and term in the data row', () => {
    const line = exportCsv([row]).split('\n')[1]!;
    expect(line).toContain('4466');
    expect(line).toContain('12');
  });
});

describe('exportCsv', () => {
  it('produces a UTF-8 BOM + header row + escaped data rows', () => {
    const csv = exportCsv(sampleRows);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toMatch(/SO#,Keyed at,Paid date,Venue,Customer,SO total \(RM\),Paid \(RM\),Deposit,Method,Merchant,Installment \(months\),Approval code,Salesperson,Keyed by,Slip uploaded/);
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
    expect(sheet).toBeDefined();
    expect(sheet!['A1'].v).toBe('SO#');
    expect(sheet!['F1'].v).toBe('SO total (RM)');
    expect(sheet!['A2'].v).toBe('SO-2606-001');
    expect(typeof sheet!['F2'].v).toBe('number');
    expect(sheet!['F2'].v).toBe(5980);
  });
});
