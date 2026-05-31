// ----------------------------------------------------------------------------
// SalesOrderDetailListing — Houzs-style "Sales Order Details" line-item view
// at /reports/sales-order-detail-listing.
//
// One row per Sales Order LINE ITEM (with SO header info repeated on every
// line). 2026-05-27 — ported from the AutoCount two-card filter layout to
// match the Houzs reference exactly:
//
//   1. Header — "Sales Order Details · Line-item view · N items · drag to
//      reorder columns" (single-line)
//   2. 6 KPI tiles — Total Lines · Unique Orders · Revenue · Cost ·
//      Margin (RM + %) · Outstanding (deduped per docNo)
//   3. Compact horizontal filter row — funnel icon · global search ·
//      All Brands ▼ · All Groups ▼ · All Agents ▼ · All Venues ▼ ·
//      All Payment ▼ · Date from – to
//   4. <DataGrid> (PR-G primitive) with 33 default columns + 10 hidden by
//      default (defaultHidden:true). User reveals via right-click "Show".
//      (Was 34 before the 2026-05-27 col audit; dropped "Actions" since
//      mfg_sales_orders has no action_notes / actions field — the column
//      always rendered '—'. Restore when the schema gains an equivalent.)
//      Storage key: `so-detail-listing-grid.v2.houzs` (bump from v1 so the
//      column reorder + hide layout starts fresh on the new layout).
//
// Auto-inquiry on mount — Houzs shows data immediately. We still let the
// user narrow via filters; the query refetches on filter change. PDF
// Preview + Print + criteria-summary code retained from the previous
// AutoCount layout.
//
// ── Temporary placeholders ────────────────────────────────────────────────
// Malaysia is in a no-SST regime, so `tax_centi` is always 0; the Inclusive?
// / Tax (header/line) / Detail Tax Code columns render constants ("Yes" /
// "0.00" / "SR" in AutoCount convention) but live in the default-hidden
// long tail. SO→PO linking isn't tracked yet so Creditor Code / Post to PO
// are also default-hidden.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  ArrowLeft, ClipboardList, Printer, Eye, Filter, X, Search, Plus,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared'; // Commander 2026-05-28
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { ItemGroupPill, BrandingPill, badgeFor } from '../lib/category-badges';
import {
  useSalesOrderDetailListing,
  type SoDetailListingFilters,
  type SoDetailListingRow,
} from '../lib/flow-queries';
import styles from './SalesOrderDetailListing.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

/* Bump the storage key when migrating to the Houzs layout — the previous
   key (`so-detail-listing-grid`) held the AutoCount column order, which
   doesn't match the new Houzs columns. v2 starts fresh. */
const STORAGE_KEY = 'so-detail-listing-grid.v2.houzs';

const fmtRm = (centi: number | null | undefined, currency = ''): string => {
  const c = Number(centi ?? 0);
  const prefix = currency ? `${currency} ` : '';
  return `${prefix}${(c / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/* Compact date — "2026/05/04". */
const compactDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[1]}/${m[2]}/${m[3]}`;
};

/* Payment status pill — same warm/green/grey palette as item-group pill,
   tied to a coarse three-state derived from `payment_status` enum. */
type PayState = 'Checked' | 'Unchecked' | 'Pending';
const PAY_BADGE: Record<PayState, { bg: string; fg: string }> = {
  Checked:   { bg: 'rgba(47, 93, 79, 0.12)',  fg: 'var(--c-secondary-a, #2F5D4F)' },
  Pending:   { bg: 'rgba(199, 127, 62, 0.16)', fg: 'var(--c-festive-a, #C77F3E)' },
  Unchecked: { bg: 'rgba(34, 31, 32, 0.08)',  fg: 'var(--fg-muted)' },
};
const payStateFor = (raw: string | null | undefined): PayState => {
  if (!raw) return 'Unchecked';
  const v = String(raw).toLowerCase();
  if (v === 'checked' || v === 'paid' || v === 'cleared') return 'Checked';
  if (v === 'pending' || v === 'partial') return 'Pending';
  return 'Unchecked';
};
const PaymentPill = ({ raw }: { raw: string | null | undefined }) => {
  const state = payStateFor(raw);
  const spec = PAY_BADGE[state];
  return (
    <span style={{
      display: 'inline-flex', padding: '1px 8px',
      borderRadius: 'var(--radius-pill, 999px)',
      fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)', fontWeight: 700,
      letterSpacing: '0.06em', textTransform: 'uppercase',
      background: spec.bg, color: spec.fg,
    }}>{state}</span>
  );
};

/* Task #63 — `custom_specials` is a jsonb array with mixed element shape
   across PRs: some lines store plain strings ("Memory Foam Top"), others
   store objects (`{ label, priceCenti }` per the latest schema, or the
   older `{ description, surchargeSen }`). Render each element's most
   user-facing string and comma-join. */
const formatSpecials = (raw: unknown): string => {
  if (!Array.isArray(raw)) return '';
  const parts = raw.map((el) => {
    if (el == null) return '';
    if (typeof el === 'string') return el;
    if (typeof el === 'object') {
      const o = el as Record<string, unknown>;
      const v = o.label ?? o.description ?? o.name ?? o.value;
      return typeof v === 'string' ? v : '';
    }
    return '';
  }).filter(Boolean);
  return parts.join(', ');
};

/* ─────────────────────────────────────────────────────────────────────────
   Column factory — 47 columns total (33 visible by default + 14 hidden).
   Order mirrors the Houzs reference shot column-for-column. Houzs col 23
   "Actions" dropped in the 2026-05-27 audit (no schema field; always '—').
     1. Doc.No (orange) 2. Date 3. Debtor Name 4. Agent 5. Item Group (pill)
     6. Item Code (bold) 7. Description 8. Location 9. Qty 10. Unit Price
     11. Total 12. Line Cost 13. Margin RM 14. Margin % 15. Balance
     16. Payment (pill) 17. Venue 18. Branding (pill) 19. Fabric
     20. Divan Height 21. Leg Height 22. Specials
     23. Order Remarks 24. Status (pill) 25. Status 2 26. Processing Date
     27. Tax Exemption Expiry 28. Note 29. Paid 30. Last Payment
     31. Account Sheet 32. Approval Code 33. Collected By
   Hidden long tail (14 cols): debtor_code · uom · currency · inclusive? ·
   tax (header/line) · detail tax code · creditor code · post to PO ·
   total ex · plus 2990-extras (customer_delivery_date · internal_expected_dd ·
   customer_state · payment_method).
   ───────────────────────────────────────────────────────────────────────── */
const buildColumns = (): DataGridColumn<SoDetailListingRow>[] => {
  /* Read-out helper for the "may exist on the row but not on the type"
     fields — the API flattens the SO header onto every line, so anything
     in mfg_sales_orders is reachable via (r as Record<string, unknown>)[k]. */
  const opt = (r: SoDetailListingRow, k: string): string => {
    const v = (r as Record<string, unknown>)[k];
    if (v == null || v === '') return '';
    return String(v);
  };

  return [
    /* 1 */ {
      key: 'doc_no', label: 'Doc. No.', width: 120, sortable: true, groupable: false,
      accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
      searchValue: (r) => r.doc_no,
    },
    /* 2 */ {
      key: 'so_date', label: 'Date', width: 110, sortable: true,
      accessor: (r) => compactDate((r.so_date ?? r.line_date) as string | null),
      searchValue: (r) => String(r.so_date ?? r.line_date ?? ''),
      sortFn: (a, b) => String(a.so_date ?? a.line_date ?? '').localeCompare(String(b.so_date ?? b.line_date ?? '')),
    },
    /* 3 */ {
      key: 'debtor_name', label: 'Debtor Name', width: 200, sortable: true, groupable: true,
      accessor: (r) => r.debtor_name ?? '—',
      searchValue: (r) => r.debtor_name ?? '',
    },
    /* 4 */ {
      key: 'agent', label: 'Agent', width: 110, sortable: true, groupable: true,
      accessor: (r) => r.agent ?? '—',
      searchValue: (r) => r.agent ?? '',
      groupValue: (r) => r.agent ?? '(none)',
    },
    /* 5 */ {
      key: 'item_group', label: 'Item Group', width: 110, sortable: true, groupable: true,
      accessor: (r) => <ItemGroupPill group={r.item_group} />,
      searchValue: (r) => r.item_group ?? '',
      groupValue: (r) => r.item_group ?? '(none)',
    },
    /* 6 */ {
      key: 'item_code', label: 'Item Code', width: 120, sortable: true,
      accessor: (r) => <span style={{ fontWeight: 600 }}>{r.item_code}</span>,
      searchValue: (r) => r.item_code ?? '',
    },
    /* 7 */ {
      key: 'description', label: 'Description', width: 220, sortable: true,
      /* Commander 2026-05-28 — render the HOOKKA-style merged variant
         summary as a muted second line beneath the product description.
         `variants` rides along on the flattened row (Record<string,unknown>)
         even though it isn't a typed field. */
      accessor: (r) => {
        const variants = (r as Record<string, unknown>).variants as
          Record<string, unknown> | null | undefined;
        const summary = buildVariantSummary(r.item_group, variants);
        const manual = (r.description ?? '').trim();
        /* Commander 2026-05-29 — when there's no manual Description 1, show the
           variant summary as the cell text instead of a bare "—" above it (the
           dash confused the operator). Manual text, when present, keeps the
           summary muted below it. */
        if (manual) {
          return (
            <div>
              <div>{manual}</div>
              {summary && (
                <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>{summary}</div>
              )}
            </div>
          );
        }
        return <div>{summary || '—'}</div>;
      },
      searchValue: (r) => r.description ?? '',
    },
    /* 8 */ {
      key: 'location', label: 'Location', width: 80, sortable: true, groupable: true,
      accessor: (r) => r.location ?? '—',
      searchValue: (r) => r.location ?? '',
    },
    /* 9 */ {
      key: 'qty', label: 'Qty', width: 60, align: 'right', sortable: true,
      accessor: (r) => String(r.qty ?? 0),
      searchValue: (r) => String(r.qty ?? 0),
      sortFn: (a, b) => Number(a.qty ?? 0) - Number(b.qty ?? 0),
    },
    /* 10 */ {
      key: 'unit_price', label: 'Unit Price', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.unit_price_centi),
      searchValue: (r) => fmtRm(r.unit_price_centi),
      sortFn: (a, b) => (a.unit_price_centi ?? 0) - (b.unit_price_centi ?? 0),
    },
    /* 11 */ {
      key: 'total', label: 'Total', width: 120, align: 'right', sortable: true,
      accessor: (r) => <span style={{ fontWeight: 600 }}>{fmtRm(r.total_centi)}</span>,
      searchValue: (r) => fmtRm(r.total_centi),
      sortFn: (a, b) => (a.total_centi ?? 0) - (b.total_centi ?? 0),
    },
    /* 12 */ {
      key: 'line_cost', label: 'Line Cost', width: 110, align: 'right', sortable: true,
      accessor: (r) => (r.line_cost_centi ?? 0) > 0 ? fmtRm(r.line_cost_centi) : <span style={{ color: 'var(--fg-muted)' }}>—</span>,
      searchValue: (r) => fmtRm(r.line_cost_centi ?? 0),
      sortFn: (a, b) => (a.line_cost_centi ?? 0) - (b.line_cost_centi ?? 0),
    },
    /* 13 */ {
      key: 'line_margin', label: 'Margin RM', width: 110, align: 'right', sortable: true,
      accessor: (r) => {
        const m = r.line_margin_centi ?? 0;
        if ((r.total_centi ?? 0) <= 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
        const color = m > 0 ? 'var(--c-secondary-a, #2F5D4F)' : m < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)';
        return <span style={{ color, fontWeight: 600 }}>{fmtRm(m)}</span>;
      },
      searchValue: (r) => fmtRm(r.line_margin_centi ?? 0),
      sortFn: (a, b) => (a.line_margin_centi ?? 0) - (b.line_margin_centi ?? 0),
    },
    /* 14 */ {
      key: 'margin_pct', label: 'Margin %', width: 90, align: 'right', sortable: true,
      accessor: (r) => {
        const rev = r.total_centi ?? 0;
        if (rev <= 0) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
        const pct = ((r.line_margin_centi ?? 0) / rev) * 100;
        const color = pct >= 50 ? 'var(--c-secondary-a, #2F5D4F)'
          : pct >= 30 ? 'var(--c-festive-a, #C77F3E)'
          : pct > 0   ? 'var(--c-burnt)'
          : 'var(--c-festive-b, #B8331F)';
        return <span style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pct.toFixed(1)}%</span>;
      },
      searchValue: (r) => {
        const rev = r.total_centi ?? 0;
        if (rev <= 0) return '';
        return `${(((r.line_margin_centi ?? 0) / rev) * 100).toFixed(1)}%`;
      },
      sortFn: (a, b) => {
        const aPct = (a.total_centi ?? 0) > 0 ? (a.line_margin_centi ?? 0) / a.total_centi! : 0;
        const bPct = (b.total_centi ?? 0) > 0 ? (b.line_margin_centi ?? 0) / b.total_centi! : 0;
        return aPct - bPct;
      },
    },
    /* 15 */ {
      key: 'balance', label: 'Balance', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.balance_centi ?? 0),
      searchValue: (r) => fmtRm(r.balance_centi ?? 0),
      sortFn: (a, b) => (a.balance_centi ?? 0) - (b.balance_centi ?? 0),
    },
    /* 16 */ {
      key: 'payment', label: 'Payment', width: 100, sortable: true, groupable: true,
      accessor: (r) => <PaymentPill raw={opt(r, 'payment_status')} />,
      searchValue: (r) => payStateFor(opt(r, 'payment_status')),
      groupValue: (r) => payStateFor(opt(r, 'payment_status')),
    },
    /* 17 */ {
      key: 'venue', label: 'Venue', width: 160, sortable: true, groupable: true,
      accessor: (r) => opt(r, 'venue') || '—',
      searchValue: (r) => opt(r, 'venue'),
      groupValue: (r) => opt(r, 'venue') || '(none)',
    },
    /* 18 — Commander 2026-05-29: branding hidden by default (reveal via the
       Columns menu when needed); the brand is implicit at order time. */
    {
      key: 'branding', label: 'Branding', width: 110, sortable: true, groupable: true,
      defaultHidden: true,
      accessor: (r) => <BrandingPill branding={r.branding} />,
      searchValue: (r) => r.branding ?? '',
      groupValue: (r) => r.branding ?? '(none)',
    },
    /* 19 — Task #63: typed read from variants->>'fabricColor' (extracted
       server-side as `fabric` on the row). */
    {
      /* Commander 2026-05-28 — unify fabric/colour term → "Fabrics".
         Column key 'fabric' unchanged; only the display label. */
      key: 'fabric', label: 'Fabrics', width: 120, sortable: true,
      accessor: (r) => r.fabric ?? '—',
      searchValue: (r) => r.fabric ?? '',
    },
    /* 20 — Task #63: integer inches column rendered as `30"` etc. */
    {
      key: 'divan_height', label: 'Divan Height', width: 110, sortable: true, align: 'right',
      accessor: (r) => r.divan_height != null ? `${r.divan_height}"` : '—',
      searchValue: (r) => r.divan_height != null ? String(r.divan_height) : '',
      sortFn: (a, b) => (a.divan_height ?? 0) - (b.divan_height ?? 0),
    },
    /* 21 — Task #63: integer inches column rendered as `4"` etc. */
    {
      key: 'leg_height', label: 'Leg Height', width: 100, sortable: true, align: 'right',
      accessor: (r) => r.leg_height != null ? `${r.leg_height}"` : '—',
      searchValue: (r) => r.leg_height != null ? String(r.leg_height) : '',
      sortFn: (a, b) => (a.leg_height ?? 0) - (b.leg_height ?? 0),
    },
    /* 22 — Task #63: custom_specials is a jsonb array. Element shape
       varies across PRs (some lines store strings, others store
       `{ label } | { description }` objects), so coerce to a label
       string per element and comma-join. */
    {
      key: 'specials', label: 'Specials', width: 160, sortable: true,
      accessor: (r) => formatSpecials(r.custom_specials) || '—',
      searchValue: (r) => formatSpecials(r.custom_specials),
    },
    /* 23 — Actions col DROPPED in audit pass (2026-05-27). Houzs uses this
       for free-text delivery action notes; 2990's schema has no equivalent
       field on mfg_sales_orders / mfg_sales_order_items, so the column
       always rendered '—'. Dead UI surface → removed rather than padded
       with a placeholder. Re-add when an `action_notes` column lands. */
    /* 24 */ {
      key: 'order_remarks', label: 'Order Remarks', width: 160, sortable: true,
      accessor: (r) => opt(r, 'remark') || opt(r, 'note') || '—',
      searchValue: (r) => opt(r, 'remark') || opt(r, 'note'),
    },
    /* 25 */ {
      key: 'status', label: 'Status', width: 130, sortable: true, groupable: true,
      accessor: (r) => {
        const s = r.status ?? '';
        if (!s) return '—';
        const color = s === 'CANCELLED' ? 'var(--c-festive-b, #B8331F)'
          : s === 'DELIVERED' || s === 'CLOSED' ? 'var(--c-secondary-a, #2F5D4F)'
          : 'var(--c-burnt)';
        return <span style={{
          display: 'inline-flex', padding: '1px 8px',
          borderRadius: 'var(--radius-pill, 999px)',
          background: 'rgba(232, 107, 58, 0.10)', color,
          fontFamily: 'var(--font-button)', fontSize: 'var(--fs-10)',
          fontWeight: 700, letterSpacing: '0.06em',
        }}>{s.replace(/_/g, ' ')}</span>;
      },
      searchValue: (r) => r.status ?? '',
      groupValue: (r) => r.status ?? '(none)',
    },
    /* 26 — Status 2: secondary lifecycle state (Houzs uses for sub-status
       like "Photo Sent", "Awaiting Driver" etc.). Sourced from the
       header's `remark2` text column (typed on the row). */
    {
      key: 'status_2', label: 'Status 2', width: 110, sortable: true, groupable: true,
      accessor: (r) => r.remark2 ?? '—',
      searchValue: (r) => r.remark2 ?? '',
      groupValue: (r) => r.remark2 ?? '(none)',
    },
    /* 27 */ {
      /* "Processing Date" = internal_expected_dd (renamed app-wide PR #121/#140;
         SO New/Detail/OrderInfoCard read+write it under this label). The raw
         processing_date column is dead — nothing writes it — so read
         internal_expected_dd here. Duplicate "Internal DD" column removed.
         Commander 2026-05-28. */
      key: 'processing_date', label: 'Processing Date', width: 130, sortable: true,
      accessor: (r) => { const v = opt(r, 'internal_expected_dd'); return v ? compactDate(v) : '—'; },
      searchValue: (r) => opt(r, 'internal_expected_dd'),
    },
    /* 28 */ {
      key: 'tax_expiry', label: 'Tax Exemption Expiry', width: 150, sortable: true,
      accessor: (r) => r.sales_exemption_expiry ? compactDate(r.sales_exemption_expiry) : '—',
      searchValue: (r) => r.sales_exemption_expiry ?? '',
    },
    /* 29 */ {
      key: 'note', label: 'Note', width: 160, sortable: true,
      accessor: (r) => opt(r, 'note') || opt(r, 'remark3') || '—',
      searchValue: (r) => opt(r, 'note') || opt(r, 'remark3'),
    },
    /* 30 */ {
      key: 'paid', label: 'Paid', width: 110, align: 'right', sortable: true,
      accessor: (r) => fmtRm(r.paid_total_centi ?? 0),
      searchValue: (r) => fmtRm(r.paid_total_centi ?? 0),
      sortFn: (a, b) => (a.paid_total_centi ?? 0) - (b.paid_total_centi ?? 0),
    },
    /* 31 — Task #63: last payment date sourced server-side as MAX(paid_at)
       from mfg_sales_order_payments per SO. */
    {
      key: 'last_payment', label: 'Last Payment', width: 120, sortable: true,
      accessor: (r) => r.last_payment_at ? compactDate(r.last_payment_at) : '—',
      searchValue: (r) => r.last_payment_at ?? '',
      sortFn: (a, b) => String(a.last_payment_at ?? '').localeCompare(String(b.last_payment_at ?? '')),
    },
    /* 32 — Task #63: most-recent payment's account_sheet (bank account /
       cashbook) from mfg_sales_order_payments. */
    {
      key: 'account_sheet', label: 'Account Sheet', width: 130, sortable: true, groupable: true,
      accessor: (r) => r.account_sheet ?? '—',
      searchValue: (r) => r.account_sheet ?? '',
      groupValue: (r) => r.account_sheet ?? '(none)',
    },
    /* 33 — Task #63: most-recent payment's approval_code (auth / slip /
       receipt no); falls back to legacy header-level approval_code for
       SOs predating the payments ledger. */
    {
      key: 'approval_code', label: 'Approval Code', width: 130, sortable: true,
      accessor: (r) => r.approval_code ?? '—',
      searchValue: (r) => r.approval_code ?? '',
    },
    /* 34 — Task #63: most-recent payment's collected_by, resolved
       server-side from staff.id → staff.name. */
    {
      key: 'collected_by', label: 'Collected By', width: 130, sortable: true, groupable: true,
      accessor: (r) => r.collected_by ?? '—',
      searchValue: (r) => r.collected_by ?? '',
      groupValue: (r) => r.collected_by ?? '(none)',
    },
    /* ── Default-hidden long tail (10 columns) ────────────────────────── */
    {
      key: 'debtor_code', label: 'Debtor Code', width: 110, sortable: true,
      defaultHidden: true,
      accessor: (r) => r.debtor_code ?? '',
      searchValue: (r) => r.debtor_code ?? '',
    },
    {
      key: 'uom', label: 'UOM', width: 70, sortable: true,
      defaultHidden: true,
      accessor: (r) => r.uom ?? '',
      searchValue: (r) => r.uom ?? '',
    },
    {
      key: 'currency', label: 'Curr.', width: 70, sortable: true,
      defaultHidden: true,
      accessor: (r) => r.currency ?? 'MYR',
      searchValue: (r) => r.currency ?? 'MYR',
    },
    {
      /* No-SST regime — constant "Yes" until SST returns. */
      key: 'inclusive', label: 'Inclusive?', width: 80, sortable: false,
      defaultHidden: true,
      accessor: () => 'Yes',
      searchValue: () => 'Yes',
    },
    {
      key: 'tax_header', label: 'Tax (Header)', width: 100, align: 'right', sortable: false,
      defaultHidden: true,
      accessor: () => fmtRm(0),
      searchValue: () => fmtRm(0),
    },
    {
      key: 'tax_line', label: 'Tax (Line)', width: 100, align: 'right', sortable: false,
      defaultHidden: true,
      accessor: () => fmtRm(0),
      searchValue: () => fmtRm(0),
    },
    {
      /* No-SST regime — constant "SR" (Standard Rated 0%). */
      key: 'detail_tax_code', label: 'Detail Tax Code', width: 120, sortable: false,
      defaultHidden: true,
      accessor: () => 'SR',
      searchValue: () => 'SR',
    },
    {
      /* SO→PO linking not tracked yet — render dash. */
      key: 'creditor_code', label: 'Creditor Code', width: 110, sortable: false,
      defaultHidden: true,
      accessor: () => '—',
      searchValue: () => '',
    },
    {
      key: 'post_to_po', label: 'Post to PO', width: 100, sortable: false,
      defaultHidden: true,
      accessor: () => '—',
      searchValue: () => '',
    },
    {
      key: 'total_ex', label: 'Total (Ex)', width: 110, align: 'right', sortable: true,
      defaultHidden: true,
      accessor: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0)),
      searchValue: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0)),
      sortFn: (a, b) =>
        ((a.total_centi ?? 0) - (a.tax_centi ?? 0)) -
        ((b.total_centi ?? 0) - (b.tax_centi ?? 0)),
    },
    /* ── 2990-extra (default-hidden) ─ surfaced fields the report can show
       but Houzs doesn't have. Right-click "Show column" to enable. ─── */
    {
      /* Header field on mfg_sales_orders, flattened onto every line in the
         API (apps/api/src/routes/reports.ts L73). */
      key: 'customer_delivery_date_extra', label: 'Delivery Date', width: 130, sortable: true,
      defaultHidden: true,
      accessor: (r) => r.customer_delivery_date ? compactDate(r.customer_delivery_date) : '—',
      searchValue: (r) => r.customer_delivery_date ?? '',
    },
    {
      /* Customer state — populated whenever the customer record has an
         address with a known MY state (the SO snapshots it on create). */
      key: 'customer_state', label: 'State', width: 120, sortable: true, groupable: true,
      defaultHidden: true,
      accessor: (r) => opt(r, 'customer_state') || '—',
      searchValue: (r) => opt(r, 'customer_state'),
      groupValue: (r) => opt(r, 'customer_state') || '(none)',
    },
  ];
};

/* Page-level Group By is now hosted entirely inside DataGrid (drag-to-group
   banner). The previous AutoCount dropdown is dropped — Houzs has no
   equivalent on this screen.

   Static columns at module scope so DataGrid's React.memo can hit
   (Task #99). The columns hold no per-page state. */
const COLUMNS: DataGridColumn<SoDetailListingRow>[] = buildColumns();

export const SalesOrderDetailListing = () => {
  const navigate = useNavigate();
  /* Task #120 — `?outstanding=1` URL param applied to the row set. The
     line-flat report repeats outstanding per line, so we filter lines from
     docs whose (local_total − paid) > 0. Same param used on the L1 list
     and across all SO-family modules. */
  const [searchParams, setSearchParams] = useSearchParams();
  const outstandingOnly = searchParams.get('outstanding') === '1';
  const clearOutstanding = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('outstanding');
    setSearchParams(next, { replace: true });
  };

  /* ── Filter state ─────────────────────────────────────────────────
     Houzs filter row (left-to-right): funnel · search · brand · group ·
     agent · venue · payment · date from – to. Each one narrows the
     visible row-set client-side off the same one-shot query. Date range
     is the only filter sent to the server (so the page can scale beyond
     ~2k lines once the SO table grows). */
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(yearAgo);
  const [dateTo,   setDateTo]   = useState(today);
  const [search,   setSearch]   = useState('');
  const [brand,    setBrand]    = useState<string>('');
  const [group,    setGroup]    = useState<string>('');
  const [agent,    setAgent]    = useState<string>('');
  const [venue,    setVenue]    = useState<string>('');
  const [payment,  setPayment]  = useState<string>('');

  /* ── Server-side query — auto-runs (Houzs shows data immediately).
        Date range is the only filter passed server-side. */
  const committed: SoDetailListingFilters = useMemo(() => ({
    dateFrom, dateTo, sortBy: 'date',
  }), [dateFrom, dateTo]);
  const query = useSalesOrderDetailListing(committed);
  const rawRows = useMemo<SoDetailListingRow[]>(() => query.data?.rows ?? [], [query.data]);

  /* Build distinct-value lists for the dropdown options off the raw row
     set. Cheap O(n) pass — runs once per query refetch. */
  const opt = useCallback((r: SoDetailListingRow, k: string): string => {
    const v = (r as Record<string, unknown>)[k];
    if (v == null || v === '') return '';
    return String(v);
  }, []);

  const filterOptions = useMemo(() => {
    const brands = new Set<string>();
    const groups = new Set<string>();
    const agents = new Set<string>();
    const venues = new Set<string>();
    for (const r of rawRows) {
      if (r.branding) brands.add(r.branding);
      if (r.item_group) groups.add(r.item_group);
      if (r.agent) agents.add(r.agent);
      const v = opt(r, 'venue');
      if (v) venues.add(v);
    }
    return {
      brands: [...brands].sort(),
      groups: [...groups].sort(),
      agents: [...agents].sort(),
      venues: [...venues].sort(),
    };
  }, [rawRows, opt]);

  /* Apply client-side filters (brand/group/agent/venue/payment + global
     search + outstanding-only). The DataGrid still owns its own global
     search box internally, but the Houzs reference puts the search input
     in the top filter row — we pass the value down via searchValue
     column matches in the row filter below. */
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rawRows.filter((r) => {
      if (brand && r.branding !== brand) return false;
      if (group && r.item_group !== group) return false;
      if (agent && r.agent !== agent) return false;
      if (venue && opt(r, 'venue') !== venue) return false;
      if (payment && payStateFor(opt(r, 'payment_status')) !== (payment as PayState)) return false;
      if (outstandingOnly) {
        const lt = r.local_total_centi ?? 0;
        const pt = r.paid_total_centi ?? 0;
        if (lt - pt <= 0) return false;
      }
      if (q) {
        const blob = [
          r.doc_no, r.debtor_name, r.item_code, r.description,
          r.agent, opt(r, 'venue'), r.item_group, r.branding,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [rawRows, brand, group, agent, venue, payment, search, outstandingOnly, opt]);

  /* ── 6 KPI tiles — computed off the filtered row set, NOT rawRows, so
        narrowing the filters re-scopes the headline numbers (matches
        Houzs's interactive feel). Outstanding is deduped per docNo since
        the line-flat row format repeats it per line. */
  const kpis = useMemo(() => {
    const totalLines = filteredRows.length;
    const uniqueDocs = new Set<string>();
    let revenue = 0;
    let cost = 0;
    const outstandingByDoc = new Map<string, number>();
    for (const r of filteredRows) {
      uniqueDocs.add(r.doc_no);
      revenue += r.total_centi ?? 0;
      cost    += r.line_cost_centi ?? 0;
      if (!outstandingByDoc.has(r.doc_no)) {
        const ltc = r.local_total_centi ?? 0;
        const ptc = r.paid_total_centi ?? 0;
        outstandingByDoc.set(r.doc_no, Math.max(ltc - ptc, 0));
      }
    }
    const outstanding = [...outstandingByDoc.values()].reduce((s, v) => s + v, 0);
    const margin = revenue - cost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    return { totalLines, uniqueOrders: uniqueDocs.size, revenue, cost, margin, marginPct, outstanding };
  }, [filteredRows]);

  /* ── PDF preview (retained from the AutoCount layout) ──────────────── */
  const [findNonce, setFindNonce] = useState(0);

  const runPrint = () => window.print();

  /* Match the headline format Houzs uses on the title bar — drives the
       "N items · drag to reorder columns" subtitle below. */
  useEffect(() => {
    document.title = `Sales Order Details · ${kpis.totalLines} items`;
    return () => { document.title = '2990s'; };
  }, [kpis.totalLines]);

  return (
    <div className={styles.page}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </button>
          <div>
            <h1 className={styles.title}>
              <ClipboardList size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              Sales Order Details
              {outstandingOnly && <span style={{ color: 'var(--c-burnt)', marginLeft: 8 }}>· Outstanding only</span>}
            </h1>
            {outstandingOnly && (
              <p className={styles.subtitle}>
                <button type="button" onClick={clearOutstanding}
                  style={{ background: 'transparent', border: 'none', color: 'var(--c-burnt)',
                    cursor: 'pointer', textDecoration: 'underline', font: 'inherit', padding: 0 }}>
                  Clear outstanding filter
                </button>
              </p>
            )}
          </div>
        </div>
        <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="sm" onClick={runPrint}>
            <Printer {...SM_ICON} />
            <span>Print</span>
          </Button>
          {/* Task #63 — restore the "New Line Item" CTA stripped from
              the prior Houzs port. Line items only exist inside an SO,
              so this routes to the Create SO page; the user adds lines
              there and they show up here on next load. */}
          <Button variant="primary" size="sm" onClick={() => navigate('/mfg-sales-orders/new')}>
            <Plus {...SM_ICON} />
            <span>Add Line Item</span>
          </Button>
        </div>
      </div>

      {/* ── 6 KPI tiles (always rendered, scoped to current filters) ─ */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gap: 'var(--space-2)',
      }}>
        {([
          { label: 'Total Lines',    value: kpis.totalLines.toString() },
          { label: 'Unique Orders',  value: kpis.uniqueOrders.toString() },
          { label: 'Revenue (RM)',   value: fmtRm(kpis.revenue) },
          { label: 'Cost (RM)',      value: fmtRm(kpis.cost) },
          { label: 'Margin (RM + %)', value: `${fmtRm(kpis.margin)}${kpis.revenue > 0 ? ` (${kpis.marginPct.toFixed(1)}%)` : ''}`,
            accent: kpis.margin > 0 ? 'good' as const : kpis.margin < 0 ? 'bad' as const : null },
          { label: 'Outstanding (RM)', value: fmtRm(kpis.outstanding),
            accent: kpis.outstanding > 0 ? 'bad' as const : null },
        ]).map(({ label, value, accent }) => (
          <div key={label} className={styles.card} style={{
            padding: 'var(--space-2) var(--space-3)',
          }}>
            <div className={styles.cardTitle} style={{ borderBottom: 'none', padding: 0, fontSize: 'var(--fs-10)' }}>
              {label}
            </div>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: 'var(--fs-14)',
              fontVariantNumeric: 'tabular-nums',
              color: accent === 'good' ? 'var(--c-secondary-a, #2F5D4F)'
                : accent === 'bad' ? 'var(--c-festive-b, #B8331F)'
                : 'var(--c-ink)',
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Compact horizontal filter row (Houzs layout) ─────────────── */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--c-paper)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
      }}>
        <Filter size={16} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} aria-label="Filters" />
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Search size={14} strokeWidth={1.75}
            style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Doc No, debtor, SKU, agent, venue…"
            className={styles.fieldInput}
            style={{ paddingLeft: 28 }}
          />
        </div>
        <select className={styles.fieldSelect} value={brand} onChange={(e) => setBrand(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">All Brands</option>
          {filterOptions.brands.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select className={styles.fieldSelect} value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">All Groups</option>
          {filterOptions.groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className={styles.fieldSelect} value={agent} onChange={(e) => setAgent(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">All Agents</option>
          {filterOptions.agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className={styles.fieldSelect} value={venue} onChange={(e) => setVenue(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">All Venues</option>
          {filterOptions.venues.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <select className={styles.fieldSelect} value={payment} onChange={(e) => setPayment(e.target.value)} style={{ width: 'auto', minWidth: 130 }}>
          <option value="">All Payment</option>
          <option value="Checked">Checked</option>
          <option value="Unchecked">Unchecked</option>
          <option value="Pending">Pending</option>
        </select>
        <input type="date" className={styles.fieldInput} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: 'auto' }} />
        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>→</span>
        <input type="date" className={styles.fieldInput} value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: 'auto' }} />
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          {query.isFetching ? 'Loading…' : `${filteredRows.length} of ${rawRows.length} lines`}
        </span>
      </div>

      {/* ── DataGrid — 34 visible columns + 10 hidden by default ─── */}
      <section className={styles.resultCard}>
        <DataGrid<SoDetailListingRow>
          rows={filteredRows}
          columns={COLUMNS}
          storageKey={STORAGE_KEY}
          rowKey={(r) => r.id}
          searchPlaceholder="Search rows…"
          focusSearchNonce={findNonce}
          /* Houzs design — no "drag header here to group" banner above
             the grid; the page already owns the horizontal filter row. */
          groupBanner={false}
          isLoading={query.isFetching && rawRows.length === 0}
          emptyMessage={query.isFetching ? 'Loading…' : 'No rows match the current filters.'}
          onRowDoubleClick={(r) => navigate(`/mfg-sales-orders/${r.doc_no}`)}
          contextMenu={(row) => [
            { label: 'Open Sales Order', onClick: () => navigate(`/mfg-sales-orders/${row.doc_no}`) },
            { divider: true as const },
            { label: 'Focus search box', onClick: () => setFindNonce((n) => n + 1) },
          ]}
        />
      </section>
    </div>
  );
};

// Re-export the visible column-key list (for tests / debug).
export const COL_KEYS: string[] = COLUMNS.map((c) => c.key);
