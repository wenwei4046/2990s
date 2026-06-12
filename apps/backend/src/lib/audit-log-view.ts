import { PAYMENT_METHOD_DEFAULT_LABELS } from '@2990s/shared/payment-methods';
import type { AuditLogRow } from './audit-log-queries';

export type QuickRange = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90';

/** Format a Date as YYYY-MM-DD in UTC (mirrors the existing audit-log date math). */
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (base: Date, n: number): Date => {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
};

export function rangeForPreset(preset: QuickRange, now: Date = new Date()): { from: string; to: string } {
  const today = ymd(now);
  switch (preset) {
    case 'today':     return { from: today, to: today };
    case 'yesterday': { const y = ymd(addDays(now, -1)); return { from: y, to: y }; }
    case 'last7':     return { from: ymd(addDays(now, -6)),  to: today };
    case 'last30':    return { from: ymd(addDays(now, -29)), to: today };
    case 'last90':    return { from: ymd(addDays(now, -89)), to: today };
  }
}

export function presetForRange(
  from: string | undefined, to: string | undefined, now: Date = new Date(),
): QuickRange | null {
  if (!from || !to) return null;
  for (const p of ['today', 'yesterday', 'last7', 'last30', 'last90'] as const) {
    const r = rangeForPreset(p, now);
    if (r.from === from && r.to === to) return p;
  }
  return null;
}

export type AmountBadge = { kind: 'full' } | { kind: 'deposit'; pct: number; total: number };

export function amountBadge(paid: number, total: number): AmountBadge {
  if (total <= 0 || paid >= total) return { kind: 'full' };
  return { kind: 'deposit', pct: Math.round((paid / total) * 100), total };
}

export function matchesSearch(row: AuditLogRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return row.docNo.toLowerCase().includes(needle)
    || row.customerName.toLowerCase().includes(needle)
    || (row.approvalCode?.toLowerCase().includes(needle) ?? false);
}

// Labels come from the shared payment-method vocabulary (PR #501 — the
// maintenance table is the live label source; these are its seed mirrors).
export function methodLabel(method: string): string {
  return (PAYMENT_METHOD_DEFAULT_LABELS as Record<string, string>)[method] ?? method;
}

export function methodDetail(row: AuditLogRow): string | null {
  if (row.paymentMethod === 'installment') {
    return row.installmentMonths ? `${row.installmentMonths} months` : '—';
  }
  if (row.paymentMethod === 'merchant') {
    return row.merchantProvider ?? '—';
  }
  return null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
