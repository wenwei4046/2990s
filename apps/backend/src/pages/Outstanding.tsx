// ----------------------------------------------------------------------------
// Outstanding — cross-module Outstanding dashboard (PR #45).
//
// Commander 2026-05-26: "8 个 module 全部都要能 filter 出来 Outstanding
// 跟非 Outstanding 的部分. by date".
//
// One page with 8 tabs, each shows the outstanding (or completed) rows for
// that module. Date range filter applies across all tabs. Top stat strip
// shows counts + value per module from the /outstanding/summary endpoint.
// ----------------------------------------------------------------------------

import { todayMyt } from '../lib/dates';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ClipboardList, FileText, Receipt, Truck, Undo2, ScrollText, PackagePlus } from 'lucide-react';
import {
  useOutstanding,
  useOutstandingSummary,
  type OutstandingModule,
  type OutstandingFilterMode,
} from '../lib/flow-queries';
import styles from './Suppliers.module.css';

const MODULES: { value: OutstandingModule; label: string; icon: React.ReactNode; route: (row: Record<string, unknown>) => string }[] = [
  { value: 'po',          label: 'PO',          icon: <ScrollText size={14} strokeWidth={1.75} />,    route: (r) => `/purchase-orders/${r.id}` },
  { value: 'grn',         label: 'GRN',         icon: <PackagePlus size={14} strokeWidth={1.75} />,   route: (r) => `/grns/${r.id}` },
  { value: 'pi',          label: 'PI',          icon: <Receipt size={14} strokeWidth={1.75} />,       route: (r) => `/purchase-invoices/${r.id}` },
  { value: 'pr',          label: 'PR',          icon: <Undo2 size={14} strokeWidth={1.75} />,         route: (r) => `/purchase-returns/${r.id}` },
  { value: 'so',          label: 'SO',          icon: <ClipboardList size={14} strokeWidth={1.75} />, route: (r) => `/mfg-sales-orders/${r.doc_no}` },
  { value: 'do',          label: 'DO',          icon: <Truck size={14} strokeWidth={1.75} />,         route: (r) => `/mfg-delivery-orders/${r.id}` },
  { value: 'si',          label: 'SI',          icon: <FileText size={14} strokeWidth={1.75} />,      route: (r) => `/sales-invoices/${r.id}` },
];

const fmtRm = (centi: number): string =>
  `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const Outstanding = () => {
  const today = todayMyt();
  const yearAgo = todayMyt(-365);

  const [mode, setMode] = useState<OutstandingFilterMode>('outstanding');
  const [from, setFrom] = useState(yearAgo);
  const [to, setTo] = useState(today);
  const [activeModule, setActiveModule] = useState<OutstandingModule>('so');

  const summary = useOutstandingSummary({ from, to });
  const rowsQ = useOutstanding(activeModule, { mode, from, to });
  const rows = rowsQ.data?.rows ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Outstanding</h1>
        </div>
        <div className={styles.actionsRow}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-13)' }}>
            <span style={{ color: 'var(--fg-muted)' }}>From</span>
            <input type="date" className={styles.searchInput} value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-13)' }}>
            <span style={{ color: 'var(--fg-muted)' }}>To</span>
            <input type="date" className={styles.searchInput} value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} />
          </label>
          <div className={styles.statusChips}>
            <FilterChip label="Outstanding" active={mode === 'outstanding'} onClick={() => setMode('outstanding')} />
            <FilterChip label="Completed"   active={mode === 'completed'}   onClick={() => setMode('completed')} />
            <FilterChip label="All"         active={mode === 'all'}         onClick={() => setMode('all')} />
          </div>
        </div>
      </div>

      {/* Summary tiles — count + outstanding value per module, in selected date range */}
      <section style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 'var(--space-3)', marginTop: 'var(--space-3)',
      }}>
        {MODULES.map((m) => {
          const s = summary.data?.summary?.[m.value];
          const active = activeModule === m.value;
          return (
            <button key={m.value} type="button"
              onClick={() => setActiveModule(m.value)}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                background: active ? 'var(--c-ink)' : 'var(--c-paper)',
                color: active ? 'var(--c-cream)' : 'var(--c-ink)',
                border: `1px solid ${active ? 'var(--c-ink)' : 'var(--c-line, rgba(34,31,32,0.12))'}`,
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                textAlign: 'left',
              }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)', opacity: 0.8 }}>
                {m.icon}
                <span>{m.label}</span>
              </div>
              <div style={{ fontSize: 'var(--fs-22)', fontWeight: 900, marginTop: 4 }}>
                {s?.count ?? 0}
              </div>
              {!!s?.total_outstanding_centi && s.total_outstanding_centi > 0 && (
                <div style={{ fontSize: 'var(--fs-11)', opacity: 0.7, marginTop: 2 }}>
                  {fmtRm(s.total_outstanding_centi)} outstanding
                </div>
              )}
            </button>
          );
        })}
      </section>

      <p className={styles.eyebrow} style={{ marginTop: 'var(--space-3)' }}>
        {rowsQ.isLoading
          ? `Loading ${activeModule}…`
          : `${rows.length} ${activeModule.toUpperCase()} rows (${mode})`}
      </p>

      <ModuleTable
        module={activeModule}
        rows={rows}
        isLoading={rowsQ.isLoading}
      />
    </div>
  );
};

const FilterChip = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button type="button" onClick={onClick}
    style={{
      padding: '4px 12px',
      border: '1px solid var(--c-line, rgba(34,31,32,0.12))',
      borderRadius: 'var(--radius-pill)',
      background: active ? 'var(--c-orange)' : 'transparent',
      color: active ? 'var(--c-cream)' : 'var(--c-ink)',
      fontSize: 'var(--fs-13)',
      cursor: 'pointer',
      fontWeight: 600,
    }}>{label}</button>
);

const ModuleTable = ({
  module, rows, isLoading,
}: {
  module: OutstandingModule;
  rows: Array<Record<string, unknown>>;
  isLoading: boolean;
}) => {
  const config = useMemo(() => MODULES.find((m) => m.value === module)!, [module]);
  const columns: { key: string; label: string; format?: (v: unknown, r: Record<string, unknown>) => React.ReactNode }[] = (() => {
    const dateFmt = (v: unknown) => v ? String(v) : '—';
    switch (module) {
      case 'po':  return [
        { key: 'po_number', label: 'PO No' },
        { key: 'po_date',   label: 'Date', format: dateFmt },
        { key: 'expected_at', label: 'Expected', format: dateFmt },
        { key: 'status',    label: 'Status' },
        { key: 'qty_outstanding', label: 'Qty Outstanding', format: (v) => Number(v).toLocaleString() },
        { key: 'total_centi', label: 'Total', format: (v) => fmtRm(Number(v) || 0) },
      ];
      case 'grn': return [
        { key: 'grn_number', label: 'GRN No' },
        { key: 'received_at', label: 'Date', format: dateFmt },
        { key: 'status',    label: 'Status' },
      ];
      case 'pi':  return [
        { key: 'invoice_number', label: 'Invoice No' },
        { key: 'invoice_date',   label: 'Date', format: dateFmt },
        { key: 'due_date',       label: 'Due', format: dateFmt },
        { key: 'total_centi',    label: 'Total', format: (v) => fmtRm(Number(v) || 0) },
        { key: 'paid_centi',     label: 'Paid',  format: (v) => fmtRm(Number(v) || 0) },
        { key: 'outstanding_centi', label: 'Outstanding', format: (v) => fmtRm(Number(v) || 0) },
        { key: 'status',         label: 'Status' },
      ];
      case 'pr':  return [
        { key: 'return_number', label: 'PR No' },
        { key: 'return_date',   label: 'Date', format: dateFmt },
        { key: 'status',        label: 'Status' },
        { key: 'refund_centi',  label: 'Refund', format: (v) => fmtRm(Number(v) || 0) },
      ];
      case 'so':  return [
        { key: 'doc_no',     label: 'SO No' },
        { key: 'so_date',    label: 'Date', format: dateFmt },
        { key: 'debtor_name', label: 'Customer' },
        { key: 'status',     label: 'Status' },
        { key: 'total_revenue_centi', label: 'Total', format: (v) => fmtRm(Number(v) || 0) },
      ];
      case 'do':  return [
        { key: 'do_number',  label: 'DO No' },
        { key: 'do_date',    label: 'Date', format: dateFmt },
        { key: 'so_doc_no',  label: 'SO Ref' },
        { key: 'debtor_name', label: 'Customer' },
        { key: 'status',     label: 'Status' },
      ];
      case 'si':  return [
        { key: 'invoice_number', label: 'Invoice No' },
        { key: 'invoice_date',   label: 'Date', format: dateFmt },
        { key: 'due_date',       label: 'Due', format: dateFmt },
        { key: 'debtor_name',    label: 'Customer' },
        { key: 'total_centi',    label: 'Total', format: (v) => fmtRm(Number(v) || 0) },
        { key: 'paid_centi',     label: 'Paid',  format: (v) => fmtRm(Number(v) || 0) },
        { key: 'outstanding_centi', label: 'Outstanding', format: (v) => fmtRm(Number(v) || 0) },
        { key: 'status',         label: 'Status' },
      ];
    }
  })();

  return (
    <div className={styles.tableCard}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key}>{c.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {isLoading && <tr><td colSpan={columns.length + 1} className={styles.emptyRow}>Loading…</td></tr>}
          {!isLoading && rows.length === 0 && (
            <tr><td colSpan={columns.length + 1} className={styles.emptyRow}>No rows match the filters.</td></tr>
          )}
          {!isLoading && rows.map((r, i) => (
            <tr key={String(r.id ?? r.doc_no ?? i)}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.format ? c.format(r[c.key], r) : String(r[c.key] ?? '—')}
                </td>
              ))}
              <td>
                <Link to={config.route(r)} className={styles.docLink ?? ''}>
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
