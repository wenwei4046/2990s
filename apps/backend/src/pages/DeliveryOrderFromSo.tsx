// ----------------------------------------------------------------------------
// DeliveryOrderFromSo — multi-select Sales Order → Delivery Order picker.
//
// Commander 2026-05-29 redesign: MULTI-select, mirroring the PO's multi-select
// from-SO picker. Combine several Sales Orders of the SAME customer into ONE
// Delivery Order. Tick whole SOs (SO-LEVEL selection, not line-level), then hit
// "Convert N SO(s) to Delivery Order". A customer-lock keeps the merge clean:
// once one SO is ticked, SOs of a DIFFERENT customer (debtor) grey out and
// can't be picked — a DO ships to ONE customer.
//
// On convert the server merges every picked SO's lines into one DO (status
// DISPATCHED) and deducts stock; we land on the new DO in Edit mode so the
// operator can review before it settles. The SO-side single "Issue Delivery
// Order" still works too.
//
// Routing: /mfg-delivery-orders/from-so.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRightLeft, X, CheckSquare, Square } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useMfgSalesOrders, useConvertSosToDo } from '../lib/flow-queries';
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
  debtor_code: string | null;
  debtor_name: string | null;
  salesperson_id: string | null;
  branding: string | null;
  venue: string | null;
  local_total_centi: number | null;
  status: string | null;
};

/* One distinct customer key per SO — match the server's same-customer rule:
   debtor_code when present, else fall back to debtor_name. The lock greys out
   any SO whose key differs from the first ticked one. */
const custKey = (s: SoLite): string =>
  (s.debtor_code && s.debtor_code.trim())
    ? `code:${s.debtor_code.trim().toUpperCase()}`
    : `name:${(s.debtor_name ?? '').trim().toUpperCase()}`;

export const DeliveryOrderFromSo = () => {
  const navigate = useNavigate();
  const sosQ = useMfgSalesOrders(undefined);
  const convert = useConvertSosToDo();

  // Set of picked SO doc_nos.
  const [picked, setPicked] = useState<Set<string>>(new Set());
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

  const rowByDoc = useMemo(() => {
    const m = new Map<string, SoLite>();
    for (const r of rows) m.set(r.doc_no, r);
    return m;
  }, [rows]);

  /* The customer locked in by the current picks — the key of the first picked
     SO. Null when nothing is picked (every SO is selectable). */
  const lockedCustomer = useMemo(() => {
    for (const doc of picked) {
      const r = rowByDoc.get(doc);
      if (r) return custKey(r);
    }
    return null;
  }, [picked, rowByDoc]);

  // Display name for the locked customer (for the banner).
  const lockedCustomerName = useMemo(() => {
    for (const doc of picked) {
      const r = rowByDoc.get(doc);
      if (r) return r.debtor_name ?? r.debtor_code ?? '(none)';
    }
    return null;
  }, [picked, rowByDoc]);

  // A row is LOCKED when a different customer is already picked.
  const isRowLocked = (r: SoLite): boolean =>
    Boolean(lockedCustomer && custKey(r) !== lockedCustomer && !picked.has(r.doc_no));

  const togglePick = (r: SoLite) => {
    if (isRowLocked(r)) return; // can't tick a different customer
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(r.doc_no)) next.delete(r.doc_no);
      else next.add(r.doc_no);
      return next;
    });
  };

  // Select / clear all currently-VISIBLE rows. Select-all respects the lock:
  // it only adds SOs of the locked customer (or, if nothing is picked yet, all
  // SOs of the FIRST row's customer so the result is a valid single-customer set).
  const selectAll = () => {
    setPicked((cur) => {
      const next = new Set(cur);
      const key = lockedCustomer ?? (rows[0] ? custKey(rows[0]) : null);
      if (!key) return next;
      for (const r of rows) if (custKey(r) === key) next.add(r.doc_no);
      return next;
    });
  };
  const clearAll = () => setPicked(new Set());

  const pickedCount = picked.size;

  const columns = useMemo<DataGridColumn<SoLite>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => {
        const on = picked.has(r.doc_no);
        const locked = isRowLocked(r);
        return (
          <input
            type="checkbox"
            checked={on}
            disabled={locked}
            onChange={() => togglePick(r)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Pick SO ${r.doc_no}`}
            style={locked ? { cursor: 'not-allowed' } : undefined}
          />
        );
      },
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
  ], [picked, lockedCustomer, staffById]);

  const onConvert = () => {
    if (pickedCount === 0) {
      setDialog({ title: 'Nothing picked', body: 'Tick at least one Sales Order to convert first.' });
      return;
    }
    convert.mutate(
      { soDocNos: [...picked] },
      {
        onSuccess: (res) => {
          // Land on the new DO in Edit mode so the merged lines are right there.
          navigate(`/mfg-delivery-orders/${res.id}?edit=1`);
        },
        onError: (e) => setDialog({
          title: 'Convert failed',
          body: e instanceof Error ? e.message : String(e),
        }),
      },
    );
  };

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Button variant="ghost" size="sm" onClick={selectAll} disabled={rows.length === 0}>
        <CheckSquare {...ICON} /> Select all
      </Button>
      <Button variant="ghost" size="sm" onClick={clearAll} disabled={pickedCount === 0}>
        <Square {...ICON} /> Clear all
      </Button>
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/mfg-delivery-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Delivery Orders</span>
          </Link>
          <h1 className={styles.title}>Pick Sales Orders to convert</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/mfg-delivery-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onConvert}
            disabled={pickedCount === 0 || convert.isPending}
            title="Merge the picked Sales Orders into one Delivery Order"
          >
            <ArrowRightLeft {...ICON} />
            {convert.isPending
              ? 'Converting…'
              : pickedCount === 0
                ? 'Pick at least 1 SO'
                : `Convert ${pickedCount} SO${pickedCount === 1 ? '' : 's'} to Delivery Order`}
          </Button>
        </div>
      </div>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        Combine several Sales Orders of the SAME customer into ONE Delivery Order. The DO copies the
        first SO's customer, address, salesperson, and branding, and merges every picked SO's line
        items (with variants + prices). On convert it ships immediately and deducts stock — you can
        review and edit it on the next screen.
      </p>
      {lockedCustomerName && (
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          One customer per Delivery Order — locked to <strong>{lockedCustomerName}</strong>. Other
          customers' Sales Orders are greyed out; clear picks to switch.
        </p>
      )}

      <DataGrid<SoLite>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.doc_no}
        searchPlaceholder="Search SO, customer…"
        onRowClick={(r) => togglePick(r)}
        rowStyle={(r) => isRowLocked(r)
          ? { opacity: 0.45, background: 'var(--c-cream)', cursor: 'not-allowed' }
          : undefined}
        toolbar={toolbar}
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
