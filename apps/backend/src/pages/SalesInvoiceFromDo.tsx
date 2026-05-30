// ----------------------------------------------------------------------------
// SalesInvoiceFromDo — multi-select Delivery Order → Sales Invoice picker.
//
// MULTI-select, mirroring DeliveryOrderFromSo (the DO's from-SO picker).
// Combine several Delivery Orders of the SAME customer into ONE Sales Invoice.
// Tick whole DOs (DO-LEVEL selection, not line-level), then hit "Convert N
// DO(s) to Sales Invoice". A customer-lock keeps the merge clean: once one DO
// is ticked, DOs of a DIFFERENT customer (debtor) grey out and can't be picked
// — an invoice bills ONE customer.
//
// On convert the server merges every picked DO's lines into one invoice (status
// SENT), recomputes the total, then records revenue (Dr Accounts Receivable /
// Cr Sales Revenue) for that total. We land on the new invoice's detail.
//
// Two modes:
//   • Default — merge the picked DOs into ONE new Sales Invoice (revenue posted
//     on create). Lands on the new invoice's detail.
//   • Target (?siId) — opened from a Sales Invoice's "Convert from DO" button.
//     Appends each picked DO's line items into that invoice, then returns to it
//     in Edit mode. (No customer lock in this mode — the invoice already has a
//     debtor; the operator is responsible for the DOs they add.)
//
// Allowed from any non-cancelled DO (DOs are SHIPPED on creation now).
//
// Routing: /sales-invoices/from-do.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRightLeft, X, CheckSquare, Square } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useMfgDeliveryOrders,
  useConvertDosToSi,
  useAppendDoToSalesInvoice,
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

/* DataGrid localStorage layout key — unique to the SI from-DO picker. */
const STORAGE_KEY = 'pr-g.si-from-do.layout.v1';

type DoLite = {
  id: string;
  do_number: string;
  so_doc_no: string | null;
  do_date: string;
  debtor_code: string | null;
  debtor_name: string | null;
  salesperson_id: string | null;
  branding: string | null;
  venue: string | null;
  local_total_centi: number | null;
  line_count?: number;
  status: string | null;
};

/* One distinct customer key per DO — match the server's same-customer rule:
   debtor_code when present, else fall back to debtor_name. The lock greys out
   any DO whose key differs from the first ticked one. */
const custKey = (d: DoLite): string =>
  (d.debtor_code && d.debtor_code.trim())
    ? `code:${d.debtor_code.trim().toUpperCase()}`
    : `name:${(d.debtor_name ?? '').trim().toUpperCase()}`;

export const SalesInvoiceFromDo = () => {
  const navigate = useNavigate();
  const dosQ = useMfgDeliveryOrders(undefined);
  const convert = useConvertDosToSi();
  const appendToSi = useAppendDoToSalesInvoice();

  /* Target mode — when opened from a Sales Invoice's "Convert from DO" button,
     ?siId appends the picked DOs' lines into that invoice and returns to it. */
  const [searchParams] = useSearchParams();
  const targetSiId = searchParams.get('siId');

  // Set of picked DO ids.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const staffQ = useStaff();
  const staffById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of (staffQ.data ?? [])) if (s.id) m.set(s.id, s.name ?? s.staffCode ?? s.id);
    return m;
  }, [staffQ.data]);

  const rows = useMemo<DoLite[]>(() => {
    const all = (dosQ.data?.deliveryOrders ?? []) as DoLite[];
    // Only non-cancelled DOs can be invoiced.
    return all.filter((d) => (d.status ?? '').toUpperCase() !== 'CANCELLED');
  }, [dosQ.data]);

  const rowById = useMemo(() => {
    const m = new Map<string, DoLite>();
    for (const r of rows) m.set(r.id, r);
    return m;
  }, [rows]);

  /* The customer locked in by the current picks — the key of the first picked
     DO. Null when nothing is picked (every DO is selectable). In target mode
     there is no lock (the invoice already has a debtor). */
  const lockedCustomer = useMemo(() => {
    if (targetSiId) return null;
    for (const id of picked) {
      const r = rowById.get(id);
      if (r) return custKey(r);
    }
    return null;
  }, [picked, rowById, targetSiId]);

  const lockedCustomerName = useMemo(() => {
    if (targetSiId) return null;
    for (const id of picked) {
      const r = rowById.get(id);
      if (r) return r.debtor_name ?? r.debtor_code ?? '(none)';
    }
    return null;
  }, [picked, rowById, targetSiId]);

  // A row is LOCKED when a different customer is already picked.
  const isRowLocked = (r: DoLite): boolean =>
    Boolean(lockedCustomer && custKey(r) !== lockedCustomer && !picked.has(r.id));

  const togglePick = (r: DoLite) => {
    if (isRowLocked(r)) return; // can't tick a different customer
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
  };

  // Select / clear all currently-VISIBLE rows. Select-all respects the lock:
  // it only adds DOs of the locked customer (or, if nothing is picked yet, all
  // DOs of the FIRST row's customer so the result is a valid single-customer
  // set). In target mode (no lock) it adds everything.
  const selectAll = () => {
    setPicked((cur) => {
      const next = new Set(cur);
      if (targetSiId) { for (const r of rows) next.add(r.id); return next; }
      const key = lockedCustomer ?? (rows[0] ? custKey(rows[0]) : null);
      if (!key) return next;
      for (const r of rows) if (custKey(r) === key) next.add(r.id);
      return next;
    });
  };
  const clearAll = () => setPicked(new Set());

  const pickedCount = picked.size;

  const columns = useMemo<DataGridColumn<DoLite>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => {
        const on = picked.has(r.id);
        const locked = isRowLocked(r);
        return (
          <input
            type="checkbox"
            checked={on}
            disabled={locked}
            onChange={() => togglePick(r)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Pick DO ${r.do_number}`}
            style={locked ? { cursor: 'not-allowed' } : undefined}
          />
        );
      },
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
      key: 'so_doc_no', label: 'SO Ref', width: 130, sortable: true,
      accessor: (r) => r.so_doc_no ?? '—',
      searchValue: (r) => r.so_doc_no ?? '',
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
      key: 'local_total_centi', label: 'DO Total', width: 130, align: 'right', sortable: true,
      accessor: (r) => (
        <span style={{ fontWeight: 700, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtRm(r.local_total_centi ?? 0)}</span>
      ),
      searchValue: (r) => fmtRm(r.local_total_centi ?? 0),
      sortFn: (a, b) => (a.local_total_centi ?? 0) - (b.local_total_centi ?? 0),
    },
  ], [picked, lockedCustomer, staffById]);

  const onConvert = () => {
    if (pickedCount === 0) {
      setDialog({ title: 'Nothing picked', body: 'Tick at least one Delivery Order to convert first.' });
      return;
    }

    if (targetSiId) {
      // Append every picked DO's lines into the target invoice, then return.
      setBusy(true);
      void (async () => {
        try {
          for (const doId of picked) {
            await appendToSi.mutateAsync({ id: targetSiId, doId });
          }
          navigate(`/sales-invoices/${targetSiId}?edit=1`);
        } catch (e) {
          setBusy(false);
          setDialog({ title: 'Convert failed', body: e instanceof Error ? e.message : String(e) });
        }
      })();
      return;
    }

    // Default — merge the picked DOs into ONE new invoice.
    convert.mutate(
      { doIds: [...picked] },
      {
        onSuccess: (res) => {
          // Land on the new invoice's detail so the merged lines are right there.
          navigate(`/sales-invoices/${res.id}`);
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

  const converting = convert.isPending || busy;
  const backTo = targetSiId ? `/sales-invoices/${targetSiId}?edit=1` : '/sales-invoices';

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to={backTo} className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>{targetSiId ? 'Back to Invoice' : 'Sales Invoices'}</span>
          </Link>
          <h1 className={styles.title}>
            {targetSiId ? 'Pick Delivery Orders to add to this Invoice' : 'Pick Delivery Orders to convert'}
          </h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate(backTo)}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onConvert}
            disabled={pickedCount === 0 || converting}
            title={targetSiId ? 'Add the picked DOs into this invoice' : 'Merge the picked Delivery Orders into one Sales Invoice'}
          >
            <ArrowRightLeft {...ICON} />
            {converting
              ? (targetSiId ? 'Adding…' : 'Converting…')
              : pickedCount === 0
                ? 'Pick at least 1 DO'
                : targetSiId
                  ? `Add ${pickedCount} DO${pickedCount === 1 ? '' : 's'}`
                  : `Convert ${pickedCount} DO${pickedCount === 1 ? '' : 's'} to Sales Invoice`}
          </Button>
        </div>
      </div>
      <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        {targetSiId
          ? 'Add every picked Delivery Order’s line items (with variants + prices) into this invoice, then review on the next screen.'
          : 'Combine several Delivery Orders of the SAME customer into ONE Sales Invoice. The invoice copies the first DO’s customer, address, salesperson, and branding, and merges every picked DO’s line items (with variants + prices). On convert it records revenue (Dr Accounts Receivable / Cr Sales Revenue) for the invoice total — you can review and edit it on the next screen.'}
      </p>
      {lockedCustomerName && (
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          One customer per Sales Invoice — locked to <strong>{lockedCustomerName}</strong>. Other
          customers' Delivery Orders are greyed out; clear picks to switch.
        </p>
      )}

      <DataGrid<DoLite>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.id}
        searchPlaceholder="Search DO, customer…"
        onRowClick={(r) => togglePick(r)}
        rowStyle={(r) => isRowLocked(r)
          ? { opacity: 0.45, background: 'var(--c-cream)', cursor: 'not-allowed' }
          : undefined}
        toolbar={toolbar}
        groupBanner={false}
        isLoading={dosQ.isLoading}
        emptyMessage="No delivery orders to invoice — every DO is cancelled or none exist yet."
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
