// 7 list-view pages for the procurement/sales flow modules:
//   GRN / Purchase Invoice / Sales Order (mfg) / Delivery Order (mfg) /
//   Sales Invoice / Consignment / Delivery Return
//
// First-cut: list + status filter + "New" primary button (stub alert; full
// create drawers come in follow-up). 2990s tokens, no Tailwind.

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Plus, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useGrns, usePurchaseInvoices, useMfgDeliveryOrders,
  useSalesInvoices, useConsignments, useDeliveryReturns,
  usePurchaseReturns, usePurchaseReturnFromGrns,
} from '../lib/flow-queries';
import {
  CreateGrnDrawer, CreatePurchaseInvoiceDrawer,
  CreateDeliveryOrderDrawer, CreateSalesInvoiceDrawer, CreateConsignmentDrawer,
  CreateDeliveryReturnDrawer,
} from './FlowDrawers';
import {
  ListingPickerDialog, ListingPickerTrigger, type ListingChoice,
} from '../components/ListingPickerDialog';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './FlowPages.module.css';

/* ────────────────────────────────────────────────────────────────────────
   Task #120 — Shared helper that wires the "Listing" toolbar picker to
   navigation + the ?outstanding=1 URL param. Each module just provides
   the L2 route and reuses the same flow.
   ──────────────────────────────────────────────────────────────────────── */
function useListingPicker(detailRoute: string | null) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const outstandingOnly = searchParams.get('outstanding') === '1';

  const onPick = (choice: ListingChoice) => {
    const next = new URLSearchParams(searchParams);
    if (choice === 'listing') {
      next.delete('outstanding');
      setSearchParams(next, { replace: true });
    } else if (choice === 'outstanding-listing') {
      next.set('outstanding', '1');
      setSearchParams(next, { replace: true });
    } else if (choice === 'detail-listing' && detailRoute) {
      navigate(detailRoute);
    } else if (choice === 'outstanding-detail-listing' && detailRoute) {
      navigate(`${detailRoute}?outstanding=1`);
    }
  };

  const clearOutstanding = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('outstanding');
    setSearchParams(next, { replace: true });
  };

  return {
    open, setOpen, onPick, outstandingOnly, clearOutstanding,
    initial: outstandingOnly ? ('outstanding-listing' as const) : ('listing' as const),
  };
}

const OutstandingChip = ({ label, onClear }: { label: string; onClear: () => void }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
    padding: 'var(--space-1) var(--space-3)',
    background: 'rgba(232, 107, 58, 0.10)',
    border: '1px solid var(--c-burnt)',
    borderRadius: 'var(--radius-pill)',
    color: 'var(--c-burnt)',
    fontFamily: 'var(--font-button)',
    fontSize: 'var(--fs-12)',
    fontWeight: 600,
    width: 'fit-content',
  }}>
    <span>{label}</span>
    <button type="button" onClick={onClear} aria-label="Clear outstanding filter"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, padding: 0, background: 'transparent', border: 'none',
        color: 'var(--c-burnt)', cursor: 'pointer', borderRadius: '50%' }}>
      <X size={14} strokeWidth={1.75} />
    </button>
  </div>
);

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtMoney = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Chip = { value: string | 'all'; label: string };

const Header = ({
  title, subtitle, onNew, newLabel, secondary,
}: {
  title: string; subtitle: string; onNew?: () => void; newLabel: string;
  /** Optional secondary action(s) rendered as a ghost button to the left of
      the primary "New X" button. Used by GRN/PI lists to surface the
      "From PO" / "From GRN" multi-pick pages (task #52). */
  secondary?: { label: string; onClick: () => void } | Array<{ label: string; onClick: () => void }>;
}) => {
  const secondaryArr = secondary
    ? (Array.isArray(secondary) ? secondary : [secondary])
    : [];
  return (
    <div className={styles.headerRow}>
      <div>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.subtitle}>{subtitle}</p>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {secondaryArr.map((s) => (
          <Button key={s.label} variant="ghost" size="md" onClick={s.onClick}>
            <Plus {...ICON} />
            <span>{s.label}</span>
          </Button>
        ))}
        {onNew && (
          <Button variant="primary" size="md" onClick={onNew}>
            <Plus {...ICON} />
            <span>{newLabel}</span>
          </Button>
        )}
      </div>
    </div>
  );
};

const StatusChips = ({
  chips, active, onPick,
}: { chips: Chip[]; active: string; onPick: (v: string) => void }) => (
  <div className={styles.statusChips}>
    {chips.map((c) => (
      <button
        key={c.value}
        type="button"
        onClick={() => onPick(c.value)}
        className={active === c.value ? `${styles.chipBtn} ${styles.chipBtnActive}` : styles.chipBtn}
      >
        {c.label}
      </button>
    ))}
  </div>
);

const ErrorBanner = ({ error, hint }: { error: unknown; hint: string }) => (
  <div className={styles.bannerWarn}>
    <strong>Failed to load.</strong>{' '}
    {error instanceof Error ? error.message : String(error)}
    <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>{hint}</span>
  </div>
);

/** Pill shown when the list is narrowed by a Smart Buttons fan-out link
 *  (e.g. /grns?poId=xxx). One-click to clear. */
const FilterPill = ({ label, onClear }: { label: string; onClear: () => void }) => (
  <div style={{
    display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
    padding: 'var(--space-1) var(--space-3)',
    background: 'rgba(232, 107, 58, 0.10)',
    border: '1px solid var(--c-orange)',
    borderRadius: 'var(--radius-pill)',
    color: 'var(--c-burnt)',
    fontFamily: 'var(--font-button)',
    fontSize: 'var(--fs-12)',
    fontWeight: 600,
  }}>
    <span>Filtered by {label}</span>
    <button
      type="button"
      onClick={onClear}
      aria-label="Clear filter"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, padding: 0,
        background: 'transparent', border: 'none', color: 'var(--c-burnt)',
        cursor: 'pointer', borderRadius: '50%',
      }}
    >
      <X size={14} strokeWidth={1.75} />
    </button>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   GRN
   ════════════════════════════════════════════════════════════════════════ */
const GRN_CHIPS: Chip[] = [
  { value: 'all', label: 'All' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'CLOSED', label: 'Closed' },
];

export const Grns = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // PR — Smart Buttons fan-out: /grns?poId=xxx narrows the list to GRNs
  // descended from that PO. One-click clear restores the full list.
  const poIdFilter = searchParams.get('poId');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data, isLoading, error } = useGrns(status === 'all' ? undefined : status);
  const rows = useMemo(() => {
    const all = data?.grns ?? [];
    if (!poIdFilter) return all;
    return all.filter((r: any) => r.purchase_order_id === poIdFilter || r.purchase_order?.id === poIdFilter);
  }, [data, poIdFilter]);
  const prFromGrns = usePurchaseReturnFromGrns();
  const clearFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('poId');
    setSearchParams(next, { replace: true });
  };

  const toggle = (id: string) => {
    setSelectedIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const selected = rows.filter((r: any) => selectedIds.has(r.id));
  const allPosted = selected.every((r: any) => r.status === 'POSTED');
  const sameSupplier = new Set(selected.map((r: any) => r.supplier?.id ?? r.supplier_id)).size <= 1;

  const convertToPr = () => {
    if (selected.length === 0) return;
    if (!allPosted) { alert('Only POSTED GRNs can be converted to a Purchase Return.'); return; }
    if (!sameSupplier) { alert('All selected GRNs must be from the same supplier.'); return; }
    prFromGrns.mutate({ grnIds: [...selectedIds] }, {
      onSuccess: (res) => {
        alert(`Created Purchase Return ${res.returnNumber} from ${res.grnCount} GRNs (${res.lineCount} rejected lines).`);
        setSelectedIds(new Set());
        navigate(`/purchase-returns/${res.id}`);
      },
      onError: (e) => alert(`Failed: ${e instanceof Error ? e.message : String(e)}`),
    });
  };

  /* Commander 2026-05-29 — the GRN list was a bare 7-column table with no
     sort / filter / column control ("Column 也没有，Filter 也没有，Sort 也没
     有"). Swap to the shared DataGrid (same chrome as SO / PO lists): per-
     column sort + filter dropdowns + show/hide columns + global search. The
     multi-select checkbox column (→ Raise Purchase Return) is preserved.
     Memoized on `selectedIds` so the controlled checkboxes re-render. */
  const grnColumns = useMemo<DataGridColumn<any>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r: any) => (
        <input
          type="checkbox"
          checked={selectedIds.has(r.id)}
          onChange={() => toggle(r.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${r.grn_number}`}
        />
      ),
    },
    {
      key: 'grn_number', label: 'GRN #', width: 140, sortable: true,
      accessor: (r: any) => <span className={styles.codeChip}>{r.grn_number}</span>,
      searchValue: (r: any) => r.grn_number ?? '',
    },
    {
      key: 'po_number', label: 'Transfer From (PO)', width: 150, sortable: true, groupable: true,
      accessor: (r: any) => <span className={styles.codeChip}>{r.purchase_order?.po_number ?? '—'}</span>,
      searchValue: (r: any) => r.purchase_order?.po_number ?? '',
      groupValue: (r: any) => r.purchase_order?.po_number ?? '(none)',
    },
    {
      key: 'supplier', label: 'Supplier', width: 220, sortable: true, groupable: true,
      accessor: (r: any) => r.supplier?.name ?? '—',
      searchValue: (r: any) => `${r.supplier?.code ?? ''} ${r.supplier?.name ?? ''}`.trim(),
      groupValue: (r: any) => r.supplier?.name ?? '(none)',
    },
    {
      key: 'received_at', label: 'Received Date', width: 120, sortable: true,
      accessor: (r: any) => (r.received_at ?? '').slice(0, 10),
      searchValue: (r: any) => r.received_at ?? '',
      sortFn: (a: any, b: any) => String(a.received_at ?? '').localeCompare(String(b.received_at ?? '')),
    },
    {
      key: 'delivery_note_ref', label: 'DN Ref', width: 130, sortable: true,
      accessor: (r: any) => r.delivery_note_ref ?? '—',
      searchValue: (r: any) => r.delivery_note_ref ?? '',
    },
    {
      key: 'status', label: 'Status', width: 110, sortable: true, groupable: true,
      accessor: (r: any) => <span className={styles.statusPill}>{r.status}</span>,
      searchValue: (r: any) => r.status ?? '',
      groupValue: (r: any) => r.status ?? '(none)',
    },
    {
      key: 'posted_at', label: 'Posted At', width: 120, sortable: true, defaultHidden: true,
      accessor: (r: any) => (r.posted_at ?? '').slice(0, 10),
      searchValue: (r: any) => r.posted_at ?? '',
    },
    {
      key: 'notes', label: 'Notes', width: 200, sortable: false, defaultHidden: true,
      accessor: (r: any) => r.notes ?? '—',
      searchValue: (r: any) => r.notes ?? '',
    },
  ], [selectedIds]);

  return (
    <div className={styles.page}>
      <Header
        title="Goods Receipt Notes"
        subtitle="GRN — receive stock against PO"
        newLabel="New GRN"
        // PR — Commander 2026-05-27: open GrnNew directly. When poId is
        // missing the page now renders a "Pick a PO" card instead of
        // bouncing back to the PO list (one-click flow, was two before).
        onNew={() => navigate('/grns/new')}
        // PR — task #52: multi-PO-line picker → one GRN per PO, auto-posted.
        secondary={{ label: 'From PO', onClick: () => navigate('/grns/from-po') }}
      />
      <StatusChips chips={GRN_CHIPS} active={status} onPick={setStatus} />
      {poIdFilter && (
        <FilterPill label={`PO ${poIdFilter.slice(0, 8)}…`} onClear={clearFilter} />
      )}
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} GRN`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="If first deploy: apply migration 0042 against Supabase." />}

      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(232, 107, 58, 0.08)',
          border: '1px solid var(--c-orange)',
          borderRadius: 'var(--radius-md)',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--c-burnt)' }}>
            {selectedIds.size} selected
            {!allPosted && ' · ⚠️ All must be POSTED'}
            {!sameSupplier && ' · ⚠️ Mixed suppliers'}
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            <Button variant="primary" size="sm"
              onClick={convertToPr}
              disabled={prFromGrns.isPending || !allPosted || !sameSupplier}>
              {prFromGrns.isPending ? 'Converting…' : `Raise Purchase Return (${selectedIds.size})`}
            </Button>
          </span>
        </div>
      )}

      <DataGrid<any>
        rows={rows}
        columns={grnColumns}
        storageKey="grn-list.layout.v1"
        rowKey={(r: any) => r.id}
        searchPlaceholder="Search GRN, PO, supplier…"
        groupBanner={false}
        isLoading={isLoading}
        /* Double-click opens the GRN; single-click row stays for the checkbox
           multi-select → Raise Purchase Return flow. */
        onRowDoubleClick={(r: any) => navigate(`/grns/${r.id}`)}
        emptyMessage='No GRNs yet — click "New GRN" to start.'
      />
      {open && <CreateGrnDrawer onClose={() => setOpen(false)} />}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Purchase Invoices
   ════════════════════════════════════════════════════════════════════════ */
const PI_CHIPS: Chip[] = [
  { value: 'all', label: 'All' },
  { value: 'POSTED', label: 'Posted' }, { value: 'PAID', label: 'Paid' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export const PurchaseInvoicesPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const poIdFilter  = searchParams.get('poId');
  const grnIdFilter = searchParams.get('grnId');
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = usePurchaseInvoices(status === 'all' ? undefined : status);
  const rows = useMemo(() => {
    let all = data?.purchaseInvoices ?? [];
    if (poIdFilter)  all = all.filter((r: any) => r.purchase_order_id === poIdFilter);
    if (grnIdFilter) all = all.filter((r: any) => r.grn_id === grnIdFilter);
    return all;
  }, [data, poIdFilter, grnIdFilter]);
  const clearFilter = (key: 'poId' | 'grnId') => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className={styles.page}>
      <Header
        title="Purchase Invoices"
        subtitle="Supplier invoices to us"
        newLabel="New Invoice"
        // PR — Phase 3: PI is created from a GRN (auto-pulls accepted lines).
        // Bouncing to GRN list forces commander to pick the right GRN first.
        onNew={() => navigate('/grns')}
        // PR — task #52: multi-GRN-line picker → one PI per GRN, auto-posted.
        secondary={{ label: 'From GRN', onClick: () => navigate('/purchase-invoices/from-grn') }}
      />
      <StatusChips chips={PI_CHIPS} active={status} onPick={setStatus} />
      {poIdFilter  && <FilterPill label={`PO ${poIdFilter.slice(0, 8)}…`}    onClear={() => clearFilter('poId')} />}
      {grnIdFilter && <FilterPill label={`GRN ${grnIdFilter.slice(0, 8)}…`}  onClear={() => clearFilter('grnId')} />}
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} invoices`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="Apply migration 0042." />}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr><th>Invoice #</th><th>Supplier</th><th>Date</th><th>Due</th><th style={{ textAlign: 'right' }}>Total</th><th>Status</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr key={r.id}
                onClick={() => navigate(`/purchase-invoices/${r.id}`)}
                style={{ cursor: 'pointer' }}>
                <td><span className={styles.codeChip}>{r.invoice_number}</span></td>
                <td>{r.supplier?.name ?? '—'}</td>
                <td>{r.invoice_date}</td>
                <td>{r.due_date ?? '—'}</td>
                <td className={styles.priceCell}>{fmtMoney(r.total_centi, r.currency)}</td>
                <td><span className={styles.statusPill}>{r.status}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={6} className={styles.emptyRow}>No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      {open && <CreatePurchaseInvoiceDrawer onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Mfg Sales Orders (HOUZS pattern)
   ════════════════════════════════════════════════════════════════════════ */
// PR-G — Rebuilt as AutoCount-style data grid. The page lives in its own
// file so the column config + toolbar wiring stay readable; re-exported
// here under the original symbol name so router + any other imports keep
// working.
export { MfgSalesOrdersList as MfgSalesOrdersPage } from './MfgSalesOrdersList';

/* ════════════════════════════════════════════════════════════════════════
   Delivery Orders (mfg)
   ════════════════════════════════════════════════════════════════════════ */
const DO_CHIPS: Chip[] = [
  { value: 'all', label: 'All' }, { value: 'LOADED', label: 'Loaded' },
  { value: 'DISPATCHED', label: 'Dispatched' }, { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'SIGNED', label: 'Signed' }, { value: 'DELIVERED', label: 'Delivered' },
  { value: 'INVOICED', label: 'Invoiced' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export const MfgDeliveryOrdersPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useMfgDeliveryOrders(status === 'all' ? undefined : status);
  const allRows = useMemo(() => data?.deliveryOrders ?? [], [data]);
  const picker = useListingPicker('/reports/delivery-order-detail-listing');
  /* Task #120 — Outstanding filter for DO L1: a DO is "outstanding" if its
     status hasn't reached DELIVERED / INVOICED / CANCELLED. */
  const rows = useMemo(() => {
    if (!picker.outstandingOnly) return allRows;
    return allRows.filter((r: any) => {
      const s = String(r.status ?? '');
      return s !== 'DELIVERED' && s !== 'INVOICED' && s !== 'CANCELLED';
    });
  }, [allRows, picker.outstandingOnly]);

  return (
    <div className={styles.page}>
      <Header
        title={`Delivery Orders${picker.outstandingOnly ? ' · Outstanding only' : ''}`}
        subtitle="DO — deliveries to customer"
        newLabel="New DO"
        onNew={() => setOpen(true)}
      />
      <ListingPickerDialog
        open={picker.open}
        onClose={() => picker.setOpen(false)}
        onChoose={picker.onPick}
        detailListingAvailable={true}
        initial={picker.initial}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <ListingPickerTrigger onClick={() => picker.setOpen(true)} />
        <StatusChips chips={DO_CHIPS} active={status} onPick={setStatus} />
      </div>
      {picker.outstandingOnly && (
        <OutstandingChip label={`Outstanding only · ${rows.length} of ${allRows.length}`} onClear={picker.clearOutstanding} />
      )}
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} delivery orders`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="Apply migration 0042." />}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr>
            <th>DO #</th><th>SO</th><th>Debtor</th><th>Date</th><th>Expected</th><th>Driver</th><th>Status</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr key={r.id}
                onClick={() => navigate(`/mfg-delivery-orders/${r.id}`)}
                style={{ cursor: 'pointer' }}>
                <td><span className={styles.codeChip}>{r.do_number}</span></td>
                <td><span className={styles.codeChip}>{r.so_doc_no ?? '—'}</span></td>
                <td>{r.debtor_name}</td>
                <td>{r.do_date}</td>
                <td>{r.expected_delivery_at ?? '—'}</td>
                <td>{r.driver_name ?? '—'}</td>
                <td><span className={styles.statusPill}>{r.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No DOs yet.</td></tr>
            )}
          </tbody>
        </table>
      {open && <CreateDeliveryOrderDrawer onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Sales Invoices
   ════════════════════════════════════════════════════════════════════════ */
const SI_CHIPS: Chip[] = [
  { value: 'all', label: 'All' }, { value: 'SENT', label: 'Sent' },
  { value: 'PARTIALLY_PAID', label: 'Partial' }, { value: 'PAID', label: 'Paid' },
  { value: 'OVERDUE', label: 'Overdue' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export const SalesInvoicesPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useSalesInvoices(status === 'all' ? undefined : status);
  const allRows = useMemo(() => data?.salesInvoices ?? [], [data]);
  const picker = useListingPicker('/reports/sales-invoice-detail-listing');
  /* Task #120 — SI outstanding = balance > 0 (total − paid). */
  const rows = useMemo(() => {
    if (!picker.outstandingOnly) return allRows;
    return allRows.filter((r: any) => Number(r.total_centi ?? 0) - Number(r.paid_centi ?? 0) > 0);
  }, [allRows, picker.outstandingOnly]);

  return (
    <div className={styles.page}>
      <Header
        title={`Sales Invoices${picker.outstandingOnly ? ' · Outstanding only' : ''}`}
        subtitle="Customer invoices from us"
        newLabel="New Invoice"
        onNew={() => setOpen(true)}
      />
      <ListingPickerDialog
        open={picker.open}
        onClose={() => picker.setOpen(false)}
        onChoose={picker.onPick}
        detailListingAvailable={true}
        initial={picker.initial}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <ListingPickerTrigger onClick={() => picker.setOpen(true)} />
        <StatusChips chips={SI_CHIPS} active={status} onPick={setStatus} />
      </div>
      {picker.outstandingOnly && (
        <OutstandingChip label={`Outstanding only · ${rows.length} of ${allRows.length}`} onClear={picker.clearOutstanding} />
      )}
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} invoices`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="Apply migration 0042." />}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr>
            <th>Invoice #</th><th>SO</th><th>Debtor</th><th>Date</th><th>Due</th>
            <th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Paid</th><th>Status</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr key={r.id}
                onClick={() => navigate(`/sales-invoices/${r.id}`)}
                style={{ cursor: 'pointer' }}>
                <td><span className={styles.codeChip}>{r.invoice_number}</span></td>
                <td><span className={styles.codeChip}>{r.so_doc_no ?? '—'}</span></td>
                <td>{r.debtor_name}</td>
                <td>{r.invoice_date}</td>
                <td>{r.due_date ?? '—'}</td>
                <td className={styles.priceCell}>{fmtMoney(r.total_centi, r.currency)}</td>
                <td className={styles.priceCell} style={{ color: 'var(--c-secondary-a)' }}>{fmtMoney(r.paid_centi, r.currency)}</td>
                <td><span className={styles.statusPill}>{r.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={8} className={styles.emptyRow}>No invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      {open && <CreateSalesInvoiceDrawer onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Consignment
   ════════════════════════════════════════════════════════════════════════ */
const CO_CHIPS: Chip[] = [
  { value: 'all', label: 'All' }, { value: 'AT_BRANCH', label: 'At Branch' },
  { value: 'SOLD', label: 'Sold' }, { value: 'RETURNED', label: 'Returned' }, { value: 'DAMAGED', label: 'Damaged' },
];

export const ConsignmentPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useConsignments(status === 'all' ? undefined : status);
  const allRows = useMemo(() => data?.consignments ?? [], [data]);
  const picker = useListingPicker('/reports/consignment-detail-listing');
  /* Task #120 — Consignment outstanding = still at branch (status === 'AT_BRANCH'). */
  const rows = useMemo(() => {
    if (!picker.outstandingOnly) return allRows;
    return allRows.filter((r: any) => String(r.status ?? '') === 'AT_BRANCH');
  }, [allRows, picker.outstandingOnly]);

  return (
    <div className={styles.page}>
      <Header
        title={`Consignment${picker.outstandingOnly ? ' · At-branch only' : ''}`}
        subtitle="Stock placed at customer branches — sells through / returns / damaged"
        newLabel="New Consignment"
        onNew={() => setOpen(true)}
      />
      <ListingPickerDialog
        open={picker.open}
        onClose={() => picker.setOpen(false)}
        onChoose={picker.onPick}
        detailListingAvailable={true}
        initial={picker.initial}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <ListingPickerTrigger onClick={() => picker.setOpen(true)} />
        <StatusChips chips={CO_CHIPS} active={status} onPick={setStatus} />
      </div>
      {picker.outstandingOnly && (
        <OutstandingChip label={`At-branch only · ${rows.length} of ${allRows.length}`} onClear={picker.clearOutstanding} />
      )}
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} consignments`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="Apply migration 0042." />}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr><th>Consign #</th><th>Debtor</th><th>Branch</th><th>Placed</th><th>Status</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr key={r.id}
                onClick={() => navigate(`/consignment/${r.id}`)}
                style={{ cursor: 'pointer' }}>
                <td><span className={styles.codeChip}>{r.consignment_number}</span></td>
                <td>{r.debtor_name}</td>
                <td>{r.branch_location ?? '—'}</td>
                <td>{r.placed_at}</td>
                <td><span className={styles.statusPill}>{r.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={5} className={styles.emptyRow}>No consignments yet.</td></tr>
            )}
          </tbody>
        </table>
      {open && <CreateConsignmentDrawer onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Delivery Returns
   ════════════════════════════════════════════════════════════════════════ */
const DR_CHIPS: Chip[] = [
  { value: 'all', label: 'All' }, { value: 'PENDING', label: 'Pending' },
  { value: 'RECEIVED', label: 'Received' }, { value: 'INSPECTED', label: 'Inspected' },
  { value: 'REFUNDED', label: 'Refunded' }, { value: 'CREDIT_NOTED', label: 'Credit Noted' },
  { value: 'REJECTED', label: 'Rejected' },
];

export const DeliveryReturnsPage = () => {
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useDeliveryReturns(status === 'all' ? undefined : status);
  const allRows = useMemo(() => data?.deliveryReturns ?? [], [data]);
  const picker = useListingPicker('/reports/delivery-return-detail-listing');
  /* Task #120 — DR outstanding = not yet settled (REFUNDED/CREDIT_NOTED/REJECTED end states). */
  const rows = useMemo(() => {
    if (!picker.outstandingOnly) return allRows;
    return allRows.filter((r: any) => {
      const s = String(r.status ?? '');
      return s !== 'REFUNDED' && s !== 'CREDIT_NOTED' && s !== 'REJECTED';
    });
  }, [allRows, picker.outstandingOnly]);

  return (
    <div className={styles.page}>
      <Header
        title={`Delivery Returns${picker.outstandingOnly ? ' · Outstanding only' : ''}`}
        subtitle="Customer returning previously-delivered goods"
        newLabel="New Return"
        onNew={() => setOpen(true)}
      />
      <ListingPickerDialog
        open={picker.open}
        onClose={() => picker.setOpen(false)}
        onChoose={picker.onPick}
        detailListingAvailable={true}
        initial={picker.initial}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <ListingPickerTrigger onClick={() => picker.setOpen(true)} />
        <StatusChips chips={DR_CHIPS} active={status} onPick={setStatus} />
      </div>
      {picker.outstandingOnly && (
        <OutstandingChip label={`Outstanding only · ${rows.length} of ${allRows.length}`} onClear={picker.clearOutstanding} />
      )}
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} returns`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="Apply migration 0042." />}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr>
            <th>Return #</th><th>DO #</th><th>Debtor</th><th>Date</th><th>Reason</th>
            <th style={{ textAlign: 'right' }}>Refund</th><th>Status</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr key={r.id}>
                <td><span className={styles.codeChip}>{r.return_number}</span></td>
                <td><span className={styles.codeChip}>{r.delivery_order_id ? '—' : '—'}</span></td>
                <td>{r.debtor_name}</td>
                <td>{r.return_date}</td>
                <td>{r.reason ?? '—'}</td>
                <td className={styles.priceCell}>{fmtMoney(r.refund_centi)}</td>
                <td><span className={styles.statusPill}>{r.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No returns yet.</td></tr>
            )}
          </tbody>
        </table>
      {open && <CreateDeliveryReturnDrawer onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Purchase Returns — we return goods to the supplier
   ════════════════════════════════════════════════════════════════════════ */
const PRT_CHIPS: Chip[] = [
  { value: 'all', label: 'All' },
  { value: 'POSTED', label: 'Posted' }, { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const PurchaseReturnsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const poIdFilter  = searchParams.get('poId');
  const grnIdFilter = searchParams.get('grnId');
  const [status, setStatus] = useState('all');
  const { data, isLoading, error } = usePurchaseReturns(status === 'all' ? undefined : status);
  const rows = useMemo(() => {
    let all = data?.purchaseReturns ?? [];
    if (poIdFilter)  all = all.filter((r: any) => r.purchase_order_id === poIdFilter || r.purchase_order?.id === poIdFilter);
    if (grnIdFilter) all = all.filter((r: any) => r.grn_id === grnIdFilter || r.grn?.id === grnIdFilter);
    return all;
  }, [data, poIdFilter, grnIdFilter]);
  const clearFilter = (key: 'poId' | 'grnId') => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    setSearchParams(next, { replace: true });
  };

  return (
    <div className={styles.page}>
      <Header
        title="Purchase Returns"
        subtitle="Defects / oversupply / wrong items returned to the supplier"
        newLabel="New Purchase Return"
        // PR — Phase 4: opens free-form return page. Commander picks
        // supplier + lines manually. To pre-fill from a GRN or PO, use
        // the "Raise Return" button on the respective detail page.
        onNew={() => navigate('/purchase-returns/new')}
      />
      <StatusChips chips={PRT_CHIPS} active={status} onPick={setStatus} />
      {poIdFilter  && <FilterPill label={`PO ${poIdFilter.slice(0, 8)}…`}    onClear={() => clearFilter('poId')} />}
      {grnIdFilter && <FilterPill label={`GRN ${grnIdFilter.slice(0, 8)}…`}  onClear={() => clearFilter('grnId')} />}
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} returns`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="Apply migration 0048." />}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr>
            <th>Return #</th><th>Supplier</th><th>Linked PO</th><th>Linked GRN</th>
            <th>Date</th><th>Reason</th>
            <th style={{ textAlign: 'right' }}>Refund</th><th>Status</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr key={r.id}
                onClick={() => navigate(`/purchase-returns/${r.id}`)}
                style={{ cursor: 'pointer' }}>
                <td><span className={styles.codeChip}>{r.return_number}</span></td>
                <td>{r.supplier?.name ?? '—'}</td>
                <td><span className={styles.codeChip}>{r.purchase_order?.po_number ?? '—'}</span></td>
                <td><span className={styles.codeChip}>{r.grn?.grn_number ?? '—'}</span></td>
                <td>{r.return_date}</td>
                <td className={styles.muted}>{r.reason ?? '—'}</td>
                <td className={styles.priceCell}>{fmtMoney(r.refund_centi)}</td>
                <td><span className={styles.statusPill}>{r.status}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={8} className={styles.emptyRow}>
                No purchase returns yet. Open a GRN with rejected items and use "Raise Purchase Return".
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
