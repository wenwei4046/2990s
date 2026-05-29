// ----------------------------------------------------------------------------
// PurchaseOrderFromSo — multi-select SO → PO picker.
//
// Commander 2026-05-28 redesign:
//   - REMOVED the "PO Defaults" card (Expected Delivery + Purchase Location).
//     Those are NOT asked anymore — the server derives each PO line's
//     warehouse from the source SO's Sales Location, and each line's delivery
//     date from the SO line's own delivery date (header expected_at / purchase
//     location are rolled up from the lines server-side).
//   - SWAPPED the bespoke card list for the shared <DataGrid> primitive
//     (same dense ledger look as MfgSalesOrdersList / SalesOrderDetailListing).
//   - ADDED toolbar filters: a date-range filter that targets SO Date /
//     Processing Date / Delivery Date, plus a Category filter.
//
// Original multi-select + partial-qty behaviour (Commander 2026-05-26) is
// preserved: tick lines, optionally edit the pick qty, hit "Create POs".
// Server groups by main supplier and emits one PO per supplier.
//
// Routing: /purchase-orders/from-so.
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X, CheckSquare, Square, Filter } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared'; // Commander 2026-05-28
import {
  useOutstandingSoItems,
  useCreatePosFromSoItems,
  type OutstandingSoItem,
} from '../lib/suppliers-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { ActionResultDialog } from '../components/ActionResultDialog';
import { ItemGroupPill } from '../lib/category-badges';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/* DataGrid localStorage layout key (commander 2026-05-28). */
const STORAGE_KEY = 'po-from-so.layout.v1';

/* Houzs-style compact pill controls for the toolbar filters — mirrors the
   inputs used on the SO list page so the density matches. */
const FILTER_INPUT: CSSProperties = {
  height: 28,
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 8px',
  fontSize: 'var(--fs-12)',
  background: 'var(--c-paper)',
  color: 'var(--c-ink)',
};

/** Category filter options. 'all' shows everything; the rest match item_group. */
const CATEGORY_OPTIONS = [
  { value: 'all',       label: 'All categories' },
  { value: 'sofa',      label: 'Sofa' },
  { value: 'bedframe',  label: 'Bedframe' },
  { value: 'mattress',  label: 'Mattress' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'service',   label: 'Service' },
] as const;

/** Which date field the range filter targets. */
const DATE_FIELD_OPTIONS = [
  { value: 'soDate',       label: 'SO Date' },
  { value: 'processing',   label: 'Processing Date' },
  { value: 'delivery',     label: 'Delivery Date' },
] as const;
type DateField = typeof DATE_FIELD_OPTIONS[number]['value'];

/** Resolve the date string for a row given the active date-field selector. */
const rowDateFor = (r: OutstandingSoItem, field: DateField): string | null => {
  if (field === 'soDate')     return r.soDate ?? null;
  if (field === 'processing') return r.processingDate ?? null;
  // delivery — prefer the SO line's own date, fall back to the SO header date.
  return r.lineDeliveryDate ?? r.deliveryDate ?? null;
};

type Pick = { picked: boolean; qty: number };

export const PurchaseOrderFromSo = () => {
  const navigate = useNavigate();
  const itemsQ   = useOutstandingSoItems();
  const create   = useCreatePosFromSoItems();

  // Map<soItemId, { picked, qty }>. Defaults: picked = false; when ticked,
  // qty defaults to remainingQty.
  const [picks, setPicks] = useState<Record<string, Pick>>({});

  // Toolbar filters (commander 2026-05-28).
  const [category, setCategory]   = useState<string>('all');
  const [dateField, setDateField] = useState<DateField>('soDate');
  const [dateFrom, setDateFrom]   = useState<string>('');
  const [dateTo, setDateTo]       = useState<string>('');

  /* Commander 2026-05-28 — PO generation mode. 'combined' = one PO per supplier
     (mattresses: dozens of SOs → 1 PO); 'per-so' = one PO per SO (sofa/bedframe:
     1 SO → 1 PO). */
  const [poMode, setPoMode] = useState<'combined' | 'per-so'>('combined');

  // In-app result dialog (Commander 2026-05-29: confirm INSIDE the page, not a
  // browser alert). goTo set → offer a navigate button.
  const [dialog, setDialog] = useState<{ title: string; body: string; goTo?: string } | null>(null);

  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);

  // ── Filtered rows fed to the grid ────────────────────────────────────
  const rows = useMemo(() => {
    return items.filter((r) => {
      if (category !== 'all' && (r.itemGroup ?? '').toLowerCase() !== category) return false;
      if (dateFrom || dateTo) {
        const d = rowDateFor(r, dateField);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo   && d > dateTo)   return false;
      }
      return true;
    });
  }, [items, category, dateField, dateFrom, dateTo]);

  // ── Pick helpers ─────────────────────────────────────────────────────
  const togglePick = (id: string, remaining: number) =>
    setPicks((s) => ({
      ...s,
      [id]: s[id]?.picked
        ? { picked: false, qty: 0 }
        : { picked: true, qty: s[id]?.qty || remaining },
    }));

  const setQty = (id: string, qty: number) =>
    setPicks((s) => ({ ...s, [id]: { picked: true, qty } }));

  // Select / clear all currently-VISIBLE rows (respects the active filters).
  const selectAll = () =>
    setPicks((s) => {
      const next = { ...s };
      for (const l of rows) next[l.soItemId] = { picked: true, qty: l.remainingQty };
      return next;
    });

  const clearAll = () => setPicks({});

  const picked = Object.entries(picks).filter(([, v]) => v.picked && v.qty > 0);
  const pickedCount = picked.length;

  // ── Columns — memoized on `picks` so the controlled checkbox + qty input
  //    re-render when pick state changes (DataGrid is React.memo'd). ───────
  const columns = useMemo<DataGridColumn<OutstandingSoItem>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => {
        const on = Boolean(picks[r.soItemId]?.picked);
        return (
          <input
            type="checkbox"
            checked={on}
            onChange={() => togglePick(r.soItemId, r.remainingQty)}
            // Stop the row-select click from also firing.
            onClick={(e) => e.stopPropagation()}
            aria-label={`Pick ${r.itemCode}`}
          />
        );
      },
    },
    {
      key: 'soDocNo', label: 'SO Doc No', width: 120, sortable: true, groupable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.soDocNo}</span>,
      searchValue: (r) => r.soDocNo,
    },
    {
      key: 'debtorName', label: 'Customer', width: 180, sortable: true, groupable: true,
      accessor: (r) => r.debtorName ?? '—',
      searchValue: (r) => r.debtorName ?? '',
      groupValue: (r) => r.debtorName ?? '(none)',
    },
    {
      key: 'itemGroup', label: 'Category', width: 110, sortable: true, groupable: true,
      accessor: (r) => <ItemGroupPill group={r.itemGroup} />,
      searchValue: (r) => r.itemGroup ?? '',
      groupValue: (r) => (r.itemGroup ?? '(none)').toUpperCase(),
    },
    {
      /* Commander 2026-05-28 — the SKU's main supplier (where this line's PO
         goes). "— none —" means unbound: it can't be converted until assigned
         a supplier. */
      key: 'mainSupplier', label: 'Main Supplier', width: 200, sortable: true, groupable: true,
      accessor: (r) =>
        r.mainSupplierCode
          ? <span>{r.mainSupplierCode}{r.mainSupplierName ? ` · ${r.mainSupplierName}` : ''}</span>
          : <span className={styles.muted} style={{ color: 'var(--c-festive-b, #B8331F)' }}>— none —</span>,
      searchValue: (r) => `${r.mainSupplierCode ?? ''} ${r.mainSupplierName ?? ''}`.trim(),
      groupValue: (r) => r.mainSupplierName ?? r.mainSupplierCode ?? '(none)',
    },
    {
      key: 'itemCode', label: 'Item Code', width: 130, sortable: true,
      accessor: (r) => <span style={{ fontWeight: 600 }}>{r.itemCode}</span>,
      searchValue: (r) => r.itemCode ?? '',
    },
    {
      key: 'description', label: 'Description', width: 240, sortable: true,
      accessor: (r) => {
        const summary = buildVariantSummary(
          r.itemGroup,
          r.variants as Record<string, unknown> | null | undefined,
        );
        return (
          <div>
            <div>{r.description ?? '—'}</div>
            {summary && (
              <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>{summary}</div>
            )}
          </div>
        );
      },
      searchValue: (r) => r.description ?? '',
    },
    {
      key: 'qty', label: 'SO Qty', width: 70, align: 'right', sortable: true,
      accessor: (r) => String(r.qty),
      sortFn: (a, b) => a.qty - b.qty,
    },
    {
      key: 'poQtyPicked', label: 'Done', width: 70, align: 'right', sortable: true,
      accessor: (r) => <span className={styles.muted}>{r.poQtyPicked}</span>,
      sortFn: (a, b) => a.poQtyPicked - b.poQtyPicked,
    },
    {
      key: 'pickQty', label: 'Pick Qty', width: 90, align: 'right', sortable: false, groupable: false,
      accessor: (r) => {
        const p = picks[r.soItemId];
        const on = Boolean(p?.picked);
        return (
          <input
            type="number"
            min={0}
            max={r.remainingQty}
            value={on ? p!.qty : ''}
            placeholder={String(r.remainingQty)}
            /* Commander 2026-05-28 — always editable: typing a qty auto-selects
               the row (no need to tick the checkbox first). */
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setQty(r.soItemId, Math.min(r.remainingQty, Math.max(0, Number(e.target.value) || 0)))}
            style={{ ...FILTER_INPUT, width: 64, textAlign: 'right' }}
          />
        );
      },
    },
    {
      key: 'deliveryDate', label: 'Delivery Date', width: 120, sortable: true,
      accessor: (r) => r.lineDeliveryDate ?? r.deliveryDate ?? '',
      searchValue: (r) => r.lineDeliveryDate ?? r.deliveryDate ?? '',
      sortFn: (a, b) =>
        String(a.lineDeliveryDate ?? a.deliveryDate ?? '')
          .localeCompare(String(b.lineDeliveryDate ?? b.deliveryDate ?? '')),
    },
    {
      key: 'lineValue', label: 'Line Value', width: 120, align: 'right', sortable: true,
      accessor: (r) => {
        const p = picks[r.soItemId];
        const pickQty = p?.picked ? p.qty : r.remainingQty;
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
            {fmtRm(pickQty * r.unitPriceCenti)}
          </span>
        );
      },
      sortFn: (a, b) => a.remainingQty * a.unitPriceCenti - b.remainingQty * b.unitPriceCenti,
    },
  ], [picks]);

  // ── Create POs ───────────────────────────────────────────────────────
  const onSave = () => {
    if (pickedCount === 0) { setDialog({ title: 'Nothing picked', body: 'Tick at least one SO line first.' }); return; }
    // Commander 2026-05-28 — no expectedAt / purchaseLocationId: the server
    // derives both per-line from the source SO.
    const body = {
      picks: picked.map(([soItemId, v]) => ({ soItemId, qty: v.qty })),
      mode: poMode,
    };
    create.mutate(body, {
      onSuccess: (res) => {
        /* A 0-PO "success" means the picked lines had no main supplier to group
           under. Don't show a hollow "Created 0 POs"; tell the user to assign
           suppliers (the Main Supplier column flags which). */
        if (!res.total) {
          setDialog({
            title: 'No POs created',
            body: "The selected SKUs aren't bound to a supplier yet. Assign each SKU a supplier (the Main Supplier column shows “— none —”), then convert again.",
          });
          return;
        }
        setPicks({});
        const summary = res.created.map((p) => p.poNumber).join(', ');
        setDialog({ title: `Created ${res.total} PO${res.total === 1 ? '' : 's'}`, body: summary, goTo: '/purchase-orders' });
      },
      onError: (err) => {
        /* Friendly message when the SKUs aren't bound to a supplier yet (the #1
           reason conversion produces no PO). */
        const raw = err instanceof Error ? err.message : String(err);
        let codes: string[] = [];
        try {
          const m = raw.match(/\{.*\}/);
          if (m) { const j = JSON.parse(m[0]); if (j.error === 'missing_bindings' && Array.isArray(j.itemCodes)) codes = j.itemCodes; }
        } catch { /* fall through to generic */ }
        setDialog(codes.length > 0
          ? { title: "SKUs not bound to a supplier", body: 'Assign these to a supplier first, then convert:\n' + codes.map((c) => `• ${c}`).join('\n') }
          : { title: 'Create failed', body: raw });
      },
    });
  };

  // ── Toolbar (filters + select/clear) rendered inside the DataGrid ──────
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Button variant="ghost" size="sm" onClick={selectAll} disabled={rows.length === 0}>
        <CheckSquare {...ICON} /> Select all
      </Button>
      <Button variant="ghost" size="sm" onClick={clearAll} disabled={pickedCount === 0}>
        <Square {...ICON} /> Clear all
      </Button>

      <span style={{ width: 1, height: 20, background: 'var(--line)' }} aria-hidden />

      <Filter size={14} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} aria-label="Filters" />

      {/* Category filter */}
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        style={FILTER_INPUT}
        aria-label="Category filter"
      >
        {CATEGORY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      {/* Date-range filter — pick which date field + from/to. */}
      <select
        value={dateField}
        onChange={(e) => setDateField(e.target.value as DateField)}
        style={FILTER_INPUT}
        aria-label="Date field"
      >
        {DATE_FIELD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => setDateFrom(e.target.value)}
        style={FILTER_INPUT}
        aria-label="Date from"
      />
      <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-11)' }}>→</span>
      <input
        type="date"
        value={dateTo}
        onChange={(e) => setDateTo(e.target.value)}
        style={FILTER_INPUT}
        aria-label="Date to"
      />
      {(category !== 'all' || dateFrom || dateTo) && (
        <button
          type="button"
          onClick={() => { setCategory('all'); setDateFrom(''); setDateTo(''); }}
          style={{
            background: 'transparent', border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)', padding: '0 10px', height: 28,
            fontSize: 'var(--fs-11)', fontWeight: 600, color: 'var(--fg-muted)', cursor: 'pointer',
          }}
        >
          Reset
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Purchase Orders</span>
          </Link>
          <h1 className={styles.title}>Create PO from Sales Orders</h1>
        </div>
        <div className={styles.actions}>
          {/* Commander 2026-05-28 — PO generation mode. Combined = one PO per
              supplier (mattress: many SOs → 1 PO). Per-SO = one PO per SO
              (sofa/bedframe: 1 SO → 1 PO). */}
          <div className={styles.modeToggle} role="group" aria-label="PO generation mode">
            <button
              type="button"
              className={styles.modeBtn}
              data-active={poMode === 'combined'}
              onClick={() => setPoMode('combined')}
              title="Merge all picked SOs into one PO per supplier"
            >
              Combined (1 PO / supplier)
            </button>
            <button
              type="button"
              className={styles.modeBtn}
              data-active={poMode === 'per-so'}
              onClick={() => setPoMode('per-so')}
              title="One PO per Sales Order (sofa / bedframe)"
            >
              Per SO (1 PO / SO)
            </button>
          </div>
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || pickedCount === 0}
          >
            <Save {...ICON} />
            {create.isPending
              ? 'Creating…'
              : pickedCount === 0
                ? 'Pick at least 1 line'
                : `Create POs (${pickedCount} line${pickedCount === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>

      <DataGrid<OutstandingSoItem>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.soItemId}
        searchPlaceholder="Search SO, customer, item…"
        /* Commander 2026-05-28 — click anywhere on a row to toggle its pick
           (the checkbox is just a visual). */
        onRowClick={(r) => togglePick(r.soItemId, r.remainingQty)}
        toolbar={toolbar}
        groupBanner={false}
        isLoading={itemsQ.isLoading}
        emptyMessage="No outstanding SO lines — every line has been converted (or there are no SOs)."
      />

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          primaryLabel={dialog.goTo ? 'Open Purchase Orders' : undefined}
          onPrimary={dialog.goTo ? () => { const g = dialog.goTo!; setDialog(null); navigate(g); } : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
