// ----------------------------------------------------------------------------
// fabric-csv — CSV export + import helpers for Fabric Converter.
// Commander 2026-05-26: avoid one-by-one form entry; round-trip via Excel.
//
// Export shape: every catalog + metric column the API exposes (except `id`,
// which is derived from fabric_code on import). UTF-8 BOM so Excel opens
// without garbled non-ASCII.
//
// Import shape: must have a `fabric_code` column (the match key). Other
// columns are optional — only those present overwrite the corresponding DB
// field. Unknown columns are reported as warnings, not errors.
// ----------------------------------------------------------------------------

import { fmtCenti } from '@2990s/shared';
import type { FabricTrackingRow } from './fabric-queries';

type ColKind = 'text' | 'int';

export type CsvColumn = {
  csv:    string;                   // header label
  field:  keyof FabricTrackingRow;  // DB row field
  apiKey: string;                   // body key for bulk-upsert
  kind:   ColKind;
};

export const CSV_COLUMNS: CsvColumn[] = [
  { csv: 'fabric_code',             field: 'fabric_code',             apiKey: 'fabricCode',           kind: 'text' },
  { csv: 'series',                  field: 'series',                  apiKey: 'series',               kind: 'text' },
  { csv: 'fabric_description',      field: 'fabric_description',      apiKey: 'fabricDescription',    kind: 'text' },
  { csv: 'supplier_code',           field: 'supplier_code',           apiKey: 'supplierCode',         kind: 'text' },
  { csv: 'supplier',                field: 'supplier',                apiKey: 'supplier',             kind: 'text' },
  { csv: 'sofa_price_tier',         field: 'sofa_price_tier',         apiKey: 'sofaPriceTier',        kind: 'text' },
  { csv: 'bedframe_price_tier',     field: 'bedframe_price_tier',     apiKey: 'bedframePriceTier',    kind: 'text' },
  { csv: 'price_centi',             field: 'price_centi',             apiKey: 'priceCenti',           kind: 'int' },
  { csv: 'soh_centi',               field: 'soh_centi',               apiKey: 'sohCenti',             kind: 'int' },
  { csv: 'po_outstanding_centi',    field: 'po_outstanding_centi',    apiKey: 'poOutstandingCenti',   kind: 'int' },
  { csv: 'last_month_usage_centi',  field: 'last_month_usage_centi',  apiKey: 'lastMonthUsageCenti',  kind: 'int' },
  { csv: 'one_week_usage_centi',    field: 'one_week_usage_centi',    apiKey: 'oneWeekUsageCenti',    kind: 'int' },
  { csv: 'two_weeks_usage_centi',   field: 'two_weeks_usage_centi',   apiKey: 'twoWeeksUsageCenti',   kind: 'int' },
  { csv: 'one_month_usage_centi',   field: 'one_month_usage_centi',   apiKey: 'oneMonthUsageCenti',   kind: 'int' },
  { csv: 'shortage_centi',          field: 'shortage_centi',          apiKey: 'shortageCenti',        kind: 'int' },
  { csv: 'reorder_point_centi',     field: 'reorder_point_centi',     apiKey: 'reorderPointCenti',    kind: 'int' },
  { csv: 'lead_time_days',          field: 'lead_time_days',          apiKey: 'leadTimeDays',         kind: 'int' },
];

const HEADER_TO_API: Record<string, CsvColumn> = Object.fromEntries(
  CSV_COLUMNS.map((c) => [c.csv, c]),
);

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: FabricTrackingRow[]): string {
  const header = CSV_COLUMNS.map((c) => c.csv).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvEscape(r[c.field])).join(',')).join('\r\n');
  return '﻿' + header + '\r\n' + body + '\r\n';
}

// ----------------------------------------------------------------------------
// HUMAN-readable export (Commander 2026-06-19). Read-only — there is NO import
// contract for this shape, so we format freely: friendly headers, internal-only
// columns (id, raw tier enum) dropped or relabelled, and every `*_centi`
// integer rendered as plain MYR (e.g. 2990.00, not 299000) so Excel sees a
// clean numeric column. We use `fmtCenti` (the shared centi→RM helper) for the
// money math, then strip its "RM " prefix and thousands separators so the cell
// stays a parseable number under the "(RM)" header. `toCsv` above stays the
// machine round-trip — do NOT route imports through this.
// ----------------------------------------------------------------------------

type HumanColumn = {
  csv:   string;                  // friendly header label
  value: (r: FabricTrackingRow) => string;
};

// Plain MYR string from centi: "2990.00". Built on the shared `fmtCenti` so the
// rounding/decimal rules stay identical to the rest of the app, then stripped
// of the "RM " prefix and "," grouping for a numeric-friendly CSV cell. Blank
// for null (rather than fmtCenti's "—") so empty cells read as empty in Excel.
const centiToRm = (centi: number | null | undefined): string => {
  if (centi == null) return '';
  return fmtCenti(centi).replace(/^RM\s*/, '').replace(/,/g, '');
};

const HUMAN_COLUMNS: HumanColumn[] = [
  { csv: 'Fabric code',         value: (r) => r.fabric_code },
  { csv: 'Fabric name',         value: (r) => r.fabric_description ?? '' },
  { csv: 'Series',              value: (r) => r.series ?? '' },
  { csv: 'Supplier code',       value: (r) => r.supplier_code ?? '' },
  { csv: 'Supplier',            value: (r) => r.supplier ?? '' },
  { csv: 'Sofa tier',           value: (r) => tierLabel(r.sofa_price_tier) },
  { csv: 'Bedframe tier',       value: (r) => tierLabel(r.bedframe_price_tier) },
  { csv: 'Price (RM)',          value: (r) => centiToRm(r.price_centi) },
  { csv: 'Stock on hand (RM)',  value: (r) => centiToRm(r.soh_centi) },
  { csv: 'PO outstanding (RM)', value: (r) => centiToRm(r.po_outstanding_centi) },
  { csv: 'Usage last week (RM)',    value: (r) => centiToRm(r.one_week_usage_centi) },
  { csv: 'Usage 2 weeks (RM)',      value: (r) => centiToRm(r.two_weeks_usage_centi) },
  { csv: 'Usage 1 month (RM)',      value: (r) => centiToRm(r.one_month_usage_centi) },
  { csv: 'Usage last month (RM)',   value: (r) => centiToRm(r.last_month_usage_centi) },
  { csv: 'Shortage (RM)',       value: (r) => centiToRm(r.shortage_centi) },
  { csv: 'Reorder point (RM)',  value: (r) => centiToRm(r.reorder_point_centi) },
  { csv: 'Lead time (days)',    value: (r) => (r.lead_time_days == null ? '' : String(r.lead_time_days)) },
];

// "PRICE_1" → "Price 1" for the readable export. Blank for null.
function tierLabel(tier: string | null | undefined): string {
  if (!tier) return '';
  const m = /^PRICE_(\d+)$/.exec(tier);
  return m ? `Price ${m[1]}` : tier;
}

export function toHumanCsv(rows: FabricTrackingRow[]): string {
  const header = HUMAN_COLUMNS.map((c) => csvEscape(c.csv)).join(',');
  const body = rows.map((r) => HUMAN_COLUMNS.map((c) => csvEscape(c.value(r))).join(',')).join('\r\n');
  return '﻿' + header + '\r\n' + body + '\r\n';
}

// Parse CSV text into a 2D grid. Handles quoted fields (including embedded
// commas, CRLF, and "" escapes). Tolerant of mixed line endings.
function parseGrid(text: string): string[][] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; continue; }
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

export type ParsedImport = {
  rows:     Array<Record<string, unknown>>;
  errors:   string[];
  warnings: string[];
};

export function parseCsv(text: string): ParsedImport {
  const grid = parseGrid(text);
  if (grid.length < 1) return { rows: [], errors: ['Empty CSV'], warnings: [] };
  const header = (grid[0] ?? []).map((h) => h.trim().toLowerCase());
  if (!header.includes('fabric_code')) {
    return { rows: [], errors: ['Header must include a fabric_code column'], warnings: [] };
  }
  const unknown = header.filter((h) => h && !HEADER_TO_API[h]);
  const warnings = unknown.length ? [`Ignoring unknown columns: ${unknown.join(', ')}`] : [];

  const rows: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => c.trim() === '')) continue;

    const obj: Record<string, unknown> = {};
    let rowOk = true;
    for (let c = 0; c < header.length; c++) {
      const headerKey = header[c];
      if (!headerKey) continue;
      const col = HEADER_TO_API[headerKey];
      if (!col) continue;
      const raw = (cells[c] ?? '').trim();
      if (col.kind === 'int') {
        if (raw === '') { obj[col.apiKey] = null; continue; }
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errors.push(`Row ${r + 1}: ${col.csv} not a number ("${raw}")`);
          rowOk = false;
          break;
        }
        obj[col.apiKey] = n;
      } else {
        obj[col.apiKey] = raw === '' ? null : raw;
      }
    }
    if (!rowOk) continue;
    if (typeof obj.fabricCode !== 'string' || (obj.fabricCode as string).length === 0) {
      errors.push(`Row ${r + 1}: missing fabric_code`);
      continue;
    }
    rows.push(obj);
  }
  return { rows, errors, warnings };
}

export function triggerDownload(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
