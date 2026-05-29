// ----------------------------------------------------------------------------
// DeliveryOrderFromSo — Sales Order → Delivery Order picker.
//
// Mirrors DeliveryReturnFromDo / PurchaseOrderFromSo: a DataGrid of the SOURCE
// documents (here, Sales Orders) where you pick one and convert it into a
// Delivery Order. This is the DO-side entry point (parity with the DR's
// "Convert from DO" button); the SO-side "Issue Delivery Order" still works too.
//
// A DO is one delivery to one customer, so this is a single-select picker: tick
// an SO row, hit "Convert to Delivery Order". We hand off to the existing
// New-DO screen (?fromSo=) which prefills the full header + lines + payments and
// — on Save — creates the DO as SHIPPED and deducts stock. Routing the operator
// through that screen lets them review / edit before the DO settles.
//
// Routing: /mfg-delivery-orders/from-so.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRightLeft, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useMfgSalesOrders } from '../lib/flow-queries';
import { useStaff } from '../lib/admin-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { ActionResultDialog } from '../components/ActionResultDialog';
import { BrandingPill } from '../lib/category-badges';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

const MONTH_3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const compactDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const y = m[1], mo = MONTH_3[Number(m[2]) - 1] ?? m[2], d = String(Number(m[3]));
  return `${d} ${mo} ${y}`;
};

const STORAGE_KEY = 'pr-g.do-from-so.layout.v1';

type SoLite = {
  doc_no: string;
  so_date: string | null;
  debtor_name: string | null;
  salesperson_id: string | null;
  branding: string | null;
  venue: string | null;
  local_total_centi: number | null;
  status: string | null;
};

export const DeliveryOrderFromSo = () => {
  const navigate = useNavigate();
  const sosQ = useMfgSalesOrders(undefined);

  const [pickedDoc, setPickedDoc] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);

  const staffQ = useStaff();
  const staffById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of (staffQ.data ?? [])) if (s.id) m.set(s.id, s.name ?? s.staffCode ?? s.id);
    return m;
  }, [staffQ.data]);

  const rows = useMemo<SoLite[]>(() => {
    const all = (sosQ.data?.salesOrders ?? []) as SoLite[];
    // Only SOs that can still ship — drop cancelled ones.
    return all.filter((s) => (s.status ?? '').toUpperCase() !== 'CANCELLED');
  }, [sosQ.data]);

  const togglePick = (doc: string) => setPickedDoc((cur) => (cur === doc ? null : doc));

  const columns = useMemo<DataGridColumn<SoLite>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => (
        <input
          type="radio"
          name="do-from-so-pick"
          checked={pickedDoc === r.doc_no}
          onChange={() => togglePick(r.doc_no)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Pick SO ${r.doc_no}`}
        />
      ),
    },
    {
      key: 'doc_no', label: 'SO No', width: 150, sortable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.doc_no}</span>,
      searchValue: (r) => r.doc_no,
    },
    {
      key: 'so_date', label: 'Date', width: 110, sortable: true,
      accessor: (r) => compactDate(r.so_date),
      searchValue: (r) => `${r.so_date ?? ''} ${compactDate(r.so_date)}`,
      sortFn: (a, b) => (a.so_date ?? '').localeCompare(b.so_date ?? ''),
    },
    {
      key: 'debtor_name', label: 'Customer', width: 220, sortable: true, groupable: true,
      accessor: (r) => r.debtor_name ?? '—',
      searchValue: (r) => r.debtor_name ?? '',
      groupValue: (r) => r.debtor_name ?? '(none)',
    },
    {
      key: 'salesperson_id', label: 'Salesperson', width: 150, sortable: true, groupable: true,
      accessor: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '—' : '—'),
      searchValue: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '' : ''),
      groupValue: (r) => (r.salesperson_id ? staffById.get(r.salesperson_id) ?? '(none)' : '(none)'),
    },
    {
      key: 'branding', label: 'Branding', width: 140, sortable: true, groupable: true,
      accessor: (r) => (r.branding ? <BrandingPill branding={r.branding} /> : <span style={{ color: 'var(--fg-muted)' }}>—</span>),
      searchValue: (r) => r.branding ?? '',
      groupValue: (r) => r.branding ?? '(none)',
    },
    {
      key: 'venue', label: 'Venue', width: 180, sortable: true, groupable: true,
      accessor: (r) => r.venue ?? '—',
      searchValue: (r) => r.venue ?? '',
      groupValue: (r) => r.venue ?? '(none)',
    },
    {
      key: 'local_total_centi', label: 'SO Value', width: 130, align: 'right', sortable: true,
      accessor: (r) => (
        <span style={{ fontWeight: 700, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtRm(r.local_total_centi ?? 0)}</span>
      ),
      searchValue: (r) => fmtRm(r.local_total_centi ?? 0),
      sortFn: (a, b) => (a.local_total_centi ?? 0) - (b.local_total_centi ?? 0),
    },
  ], [pickedDoc, staffById]);

  const onConvert = () => {
    if (!pickedDoc) { setDialog({ title: 'Nothing picked', body: 'Tick the Sales Order to convert first.' }); return; }
    // Hand off to the New-DO screen prefilled from this SO — review/edit, then
    // Save creates the DO (SHIPPED + deducts stock).
    navigate(`/mfg-delivery-orders/new?fromSo=${encodeURIComponent(pickedDoc)}`);
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/mfg-delivery-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Delivery Orders</span>
          </Link>
          <h1 className={styles.title}>Pick a Sales Order to convert</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/mfg-delivery-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onConvert}
            disabled={!pickedDoc}
            title="Prefill a new Delivery Order from the picked Sales Order"
          >
            <ArrowRightLeft {...ICON} />
            {pickedDoc ? 'Convert to Delivery Order' : 'Pick an SO'}
          </Button>
        </div>
      </div>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        A Delivery Order copies the SO's customer, address, salesperson, payments, and line items
        (with variants + prices). On Save it ships immediately and deducts stock. You can review and
        edit everything on the next screen before creating it.
      </p>

      <DataGrid<SoLite>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.doc_no}
        searchPlaceholder="Search SO, customer…"
        onRowClick={(r) => togglePick(r.doc_no)}
        groupBanner={false}
        isLoading={sosQ.isLoading}
        emptyMessage="No sales orders to convert."
      />

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
