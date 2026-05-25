// 7 list-view pages for the procurement/sales flow modules:
//   GRN / Purchase Invoice / Sales Order (mfg) / Delivery Order (mfg) /
//   Sales Invoice / Consignment / Delivery Return
//
// First-cut: list + status filter + "New" primary button (stub alert; full
// create drawers come in follow-up). 2990s tokens, no Tailwind.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useGrns, usePurchaseInvoices, useMfgSalesOrders, useMfgDeliveryOrders,
  useSalesInvoices, useConsignments, useDeliveryReturns,
  usePurchaseReturns, usePurchaseReturnFromGrns,
} from '../lib/flow-queries';
import {
  CreateGrnDrawer, CreatePurchaseInvoiceDrawer, CreateSalesOrderDrawer,
  CreateDeliveryOrderDrawer, CreateSalesInvoiceDrawer, CreateConsignmentDrawer,
  CreateDeliveryReturnDrawer,
} from './FlowDrawers';
import styles from './FlowPages.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtMoney = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Chip = { value: string | 'all'; label: string };

const Header = ({
  title, subtitle, onNew, newLabel,
}: { title: string; subtitle: string; onNew?: () => void; newLabel: string }) => (
  <div className={styles.headerRow}>
    <div>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.subtitle}>{subtitle}</p>
    </div>
    {onNew && (
      <Button variant="primary" size="md" onClick={onNew}>
        <Plus {...ICON} />
        <span>{newLabel}</span>
      </Button>
    )}
  </div>
);

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

/* ════════════════════════════════════════════════════════════════════════
   GRN
   ════════════════════════════════════════════════════════════════════════ */
const GRN_CHIPS: Chip[] = [
  { value: 'all', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'CLOSED', label: 'Closed' },
];

export const Grns = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { data, isLoading, error } = useGrns(status === 'all' ? undefined : status);
  const rows = useMemo(() => data?.grns ?? [], [data]);
  const prFromGrns = usePurchaseReturnFromGrns();

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

  return (
    <div className={styles.page}>
      <Header
        title="Goods Receipt Notes"
        subtitle="GRN — receive stock against PO"
        newLabel="New GRN"
        onNew={() => setOpen(true)}
      />
      <StatusChips chips={GRN_CHIPS} active={status} onPick={setStatus} />
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

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr>
            <th style={{ width: 36 }}></th>
            <th>GRN #</th><th>PO #</th><th>Supplier</th><th>Received</th><th>DN Ref</th><th>Status</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr key={r.id}
                onClick={() => navigate(`/grns/${r.id}`)}
                style={{ cursor: 'pointer' }}>
                <td onClick={(e) => { e.stopPropagation(); toggle(r.id); }}>
                  <input type="checkbox" checked={selectedIds.has(r.id)}
                    onChange={() => toggle(r.id)}
                    onClick={(e) => e.stopPropagation()} />
                </td>
                <td><span className={styles.codeChip}>{r.grn_number}</span></td>
                <td><span className={styles.codeChip}>{r.purchase_order?.po_number ?? '—'}</span></td>
                <td>{r.supplier?.name ?? '—'}</td>
                <td>{r.received_at}</td>
                <td>{r.delivery_note_ref ?? '—'}</td>
                <td><span className={styles.statusPill}>{r.status}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No GRNs yet — click "New GRN" to start.</td></tr>
            )}
          </tbody>
        </table>
      {open && <CreateGrnDrawer onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Purchase Invoices
   ════════════════════════════════════════════════════════════════════════ */
const PI_CHIPS: Chip[] = [
  { value: 'all', label: 'All' }, { value: 'DRAFT', label: 'Draft' },
  { value: 'POSTED', label: 'Posted' }, { value: 'PAID', label: 'Paid' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export const PurchaseInvoicesPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = usePurchaseInvoices(status === 'all' ? undefined : status);
  const rows = useMemo(() => data?.purchaseInvoices ?? [], [data]);

  return (
    <div className={styles.page}>
      <Header
        title="Purchase Invoices"
        subtitle="Supplier invoices to us"
        newLabel="New Invoice"
        onNew={() => setOpen(true)}
      />
      <StatusChips chips={PI_CHIPS} active={status} onPick={setStatus} />
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
const MSO_CHIPS: Chip[] = [
  { value: 'all', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'IN_PRODUCTION', label: 'In production' }, { value: 'READY_TO_SHIP', label: 'Ready' },
  { value: 'SHIPPED', label: 'Shipped' }, { value: 'DELIVERED', label: 'Delivered' },
  { value: 'INVOICED', label: 'Invoiced' }, { value: 'CLOSED', label: 'Closed' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export const MfgSalesOrdersPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useMfgSalesOrders(status === 'all' ? undefined : status);
  const rows = useMemo(() => data?.salesOrders ?? [], [data]);

  return (
    <div className={styles.page}>
      <Header
        title="Sales Orders (B2B)"
        subtitle="Manufacturer sales orders — HOUZS pattern, separate from retail POS orders"
        newLabel="New SO"
        onNew={() => setOpen(true)}
      />
      <StatusChips chips={MSO_CHIPS} active={status} onPick={setStatus} />
      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${rows.length} sales orders`}</p>
      {error && !isLoading && <ErrorBanner error={error} hint="Apply migration 0042." />}
      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead><tr>
            <th>Doc #</th><th>Date</th><th>Debtor</th><th>Branding</th><th>Agent</th><th>Venue</th>
            <th style={{ textAlign: 'right' }}>Total</th><th>Status</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((r: any) => (
              <tr
                key={r.doc_no}
                onClick={() => navigate(`/mfg-sales-orders/${r.doc_no}`)}
                style={{ cursor: 'pointer' }}
              >
                <td><span className={styles.codeChip}>{r.doc_no}</span></td>
                <td>{r.so_date}</td>
                <td>{r.debtor_name}</td>
                <td>{r.branding ?? '—'}</td>
                <td>{r.agent ?? '—'}</td>
                <td>{r.venue ?? '—'}</td>
                <td className={styles.priceCell}>{fmtMoney(r.local_total_centi, r.currency)}</td>
                <td><span className={styles.statusPill}>{r.status.replace('_', ' ')}</span></td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={8} className={styles.emptyRow}>No sales orders yet.</td></tr>
            )}
          </tbody>
        </table>
      {open && <CreateSalesOrderDrawer onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Delivery Orders (mfg)
   ════════════════════════════════════════════════════════════════════════ */
const DO_CHIPS: Chip[] = [
  { value: 'all', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'LOADED', label: 'Loaded' },
  { value: 'DISPATCHED', label: 'Dispatched' }, { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'SIGNED', label: 'Signed' }, { value: 'DELIVERED', label: 'Delivered' },
  { value: 'INVOICED', label: 'Invoiced' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export const MfgDeliveryOrdersPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useMfgDeliveryOrders(status === 'all' ? undefined : status);
  const rows = useMemo(() => data?.deliveryOrders ?? [], [data]);

  return (
    <div className={styles.page}>
      <Header
        title="Delivery Orders"
        subtitle="DO — deliveries to customer"
        newLabel="New DO"
        onNew={() => setOpen(true)}
      />
      <StatusChips chips={DO_CHIPS} active={status} onPick={setStatus} />
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
  { value: 'all', label: 'All' }, { value: 'DRAFT', label: 'Draft' }, { value: 'SENT', label: 'Sent' },
  { value: 'PARTIALLY_PAID', label: 'Partial' }, { value: 'PAID', label: 'Paid' },
  { value: 'OVERDUE', label: 'Overdue' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export const SalesInvoicesPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useSalesInvoices(status === 'all' ? undefined : status);
  const rows = useMemo(() => data?.salesInvoices ?? [], [data]);

  return (
    <div className={styles.page}>
      <Header
        title="Sales Invoices"
        subtitle="Customer invoices from us"
        newLabel="New Invoice"
        onNew={() => setOpen(true)}
      />
      <StatusChips chips={SI_CHIPS} active={status} onPick={setStatus} />
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
  const rows = useMemo(() => data?.consignments ?? [], [data]);

  return (
    <div className={styles.page}>
      <Header
        title="Consignment"
        subtitle="Stock placed at customer branches — sells through / returns / damaged"
        newLabel="New Consignment"
        onNew={() => setOpen(true)}
      />
      <StatusChips chips={CO_CHIPS} active={status} onPick={setStatus} />
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
  const rows = useMemo(() => data?.deliveryReturns ?? [], [data]);

  return (
    <div className={styles.page}>
      <Header
        title="Delivery Returns"
        subtitle="Customer returning previously-delivered goods"
        newLabel="New Return"
        onNew={() => setOpen(true)}
      />
      <StatusChips chips={DR_CHIPS} active={status} onPick={setStatus} />
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
  { value: 'all', label: 'All' }, { value: 'DRAFT', label: 'Draft' },
  { value: 'POSTED', label: 'Posted' }, { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

export const PurchaseReturnsPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const { data, isLoading, error } = usePurchaseReturns(status === 'all' ? undefined : status);
  const rows = useMemo(() => data?.purchaseReturns ?? [], [data]);

  return (
    <div className={styles.page}>
      <Header
        title="Purchase Returns"
        subtitle="Defects / oversupply / wrong items returned to the supplier"
        newLabel="New Purchase Return"
        onNew={() => alert('Create from a GRN — open the GRN detail page and use "Raise Purchase Return". Inline create coming soon.')}
      />
      <StatusChips chips={PRT_CHIPS} active={status} onPick={setStatus} />
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
