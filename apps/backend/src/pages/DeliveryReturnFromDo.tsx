// ----------------------------------------------------------------------------
// DeliveryReturnFromDo — Delivery Order → Delivery Return picker.
//
// Mirrors PurchaseOrderFromSo (the SO → PO picker): a DataGrid of the SOURCE
// documents (here, Delivery Orders) that converts a chosen one into the target
// (a Delivery Return). Returns can ONLY come from a DO — there is no free
// entry — so this is the sole creation path beyond the blank New form.
//
// A return comes from exactly ONE DO (one customer, one delivery), so this is
// a single-select picker: tick a DO row, hit "Create Return from DO". The
// server snapshots the DO header + copies its line items (with variants +
// prices + costs) into a new return and INCREASES stock. The new return opens
// in Edit mode so the operator can trim qty / drop lines / set conditions.
//
// Routing: /delivery-returns/from-do.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useMfgDeliveryOrders, useConvertDoToDeliveryReturn,
} from '../lib/flow-queries';
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

const STORAGE_KEY = 'pr-g.dr-from-do.layout.v1';

type DoLite = {
  id: string;
  do_number: string;
  do_date: string;
  debtor_code: string | null;
  debtor_name: string;
  salesperson_id: string | null;
  branding: string | null;
  venue: string | null;
  local_total_centi: number;
  line_count?: number;
  status: string;
};

export const DeliveryReturnFromDo = () => {
  const navigate = useNavigate();
  /* A return is only meaningful from a DO whose goods have actually gone out,
     i.e. any non-cancelled DO. The DO list returns every DO; filter out the
     cancelled ones (nothing was delivered) below. */
  const dosQ = useMfgDeliveryOrders(undefined);
  const convert = useConvertDoToDeliveryReturn();

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);

  const staffQ = useStaff();
  const staffById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of (staffQ.data ?? [])) if (s.id) m.set(s.id, s.name ?? s.staffCode ?? s.id);
    return m;
  }, [staffQ.data]);

  const rows = useMemo<DoLite[]>(() => {
    const all = (dosQ.data?.deliveryOrders ?? []) as DoLite[];
    return all.filter((d) => d.status !== 'CANCELLED');
  }, [dosQ.data]);

  const togglePick = (id: string) => setPickedId((cur) => (cur === id ? null : id));

  const columns = useMemo<DataGridColumn<DoLite>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => (
        <input
          type="radio"
          name="dr-from-do-pick"
          checked={pickedId === r.id}
          onChange={() => togglePick(r.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Pick DO ${r.do_number}`}
        />
      ),
    },
    {
      key: 'do_number', label: 'DO No', width: 150, sortable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.do_number}</span>,
      searchValue: (r) => r.do_number,
    },
    {
      key: 'do_date', label: 'Date', width: 110, sortable: true,
      accessor: (r) => compactDate(r.do_date),
      searchValue: (r) => `${r.do_date ?? ''} ${compactDate(r.do_date)}`,
      sortFn: (a, b) => (a.do_date ?? '').localeCompare(b.do_date ?? ''),
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
      key: 'line_count', label: 'Lines', width: 70, align: 'right', sortable: true,
      accessor: (r) => String(r.line_count ?? 0),
      sortFn: (a, b) => (a.line_count ?? 0) - (b.line_count ?? 0),
    },
    {
      key: 'local_total_centi', label: 'DO Value', width: 130, align: 'right', sortable: true,
      accessor: (r) => (
        <span style={{ fontWeight: 700, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtRm(r.local_total_centi)}</span>
      ),
      searchValue: (r) => fmtRm(r.local_total_centi),
      sortFn: (a, b) => a.local_total_centi - b.local_total_centi,
    },
  ], [pickedId, staffById]);

  const onSave = () => {
    if (!pickedId) { setDialog({ title: 'Nothing picked', body: 'Tick the Delivery Order to return from first.' }); return; }
    convert.mutate(
      { deliveryOrderId: pickedId },
      {
        onSuccess: (res) => {
          // Open the new return in Edit mode so the operator can trim qty /
          // drop lines / set conditions before it settles.
          navigate(`/delivery-returns/${res.id}?edit=1`);
        },
        onError: (e) => setDialog({
          title: 'Convert failed',
          body: e instanceof Error ? e.message : String(e),
        }),
      },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/delivery-returns" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Delivery Returns</span>
          </Link>
          <h1 className={styles.title}>Pick a Delivery Order to return from</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/delivery-returns')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={!pickedId || convert.isPending}
            title="Copy the picked DO's header + lines into a new Delivery Return"
          >
            <Save {...ICON} />
            {convert.isPending ? 'Converting…' : pickedId ? 'Create Return from DO' : 'Pick a DO'}
          </Button>
        </div>
      </div>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        A return copies the DO's customer, address, and line items (with variants + prices). Returned stock goes back IN.
        After converting you can trim quantities, drop lines, or set each item's condition on the return.
      </p>

      <DataGrid<DoLite>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.id}
        searchPlaceholder="Search DO, customer…"
        onRowClick={(r) => togglePick(r.id)}
        groupBanner={false}
        isLoading={dosQ.isLoading}
        emptyMessage="No delivery orders to return from."
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
