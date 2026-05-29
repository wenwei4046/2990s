// ----------------------------------------------------------------------------
// GrnFromPo — multi-select PO LINE → GRN picker.
//
// Commander 2026-05-29 redesign: made IDENTICAL to Create-PO-from-SO
// (PurchaseOrderFromSo) — same shared <DataGrid> primitive, the same toolbar
// (Select all / Clear all + category filter + date-range filter targeting
// PO Date / Expected Delivery + search + Columns config), the same dense
// ledger columns with the variant summary under each Description, and the same
// click-row-to-pick + editable Pick Qty behaviour. Only the source differs:
// outstanding PO lines (qty − received_qty > 0) instead of SO lines.
//
// Server groups picks by purchase_order_id and emits one GRN per PO (since
// grns.purchase_order_id is a single FK). Each GRN is auto-posted → inventory
// IN movements + PO.received_qty rollup + PO status flip.
//
// Routing: /grns/from-po.
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X, CheckSquare, Square, Filter } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import {
  useOutstandingPoItems,
  useCreateGrnsFromPoItems,
  type OutstandingPoItem,
} from '../lib/suppliers-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { ItemGroupPill } from '../lib/category-badges';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/* DataGrid localStorage layout key. */
const STORAGE_KEY = 'grn-from-po.layout.v1';

/* Houzs-style compact pill controls for the toolbar filters — matches the
   inputs on Create-PO-from-SO so the density is identical. */
const FILTER_INPUT: CSSProperties = {
  height: 28,
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 8px',
  fontSize: 'var(--fs-12)',
  background: 'var(--c-paper)',
  color: 'var(--c-ink)',
};

/** Category filter options — same set as Create-PO-from-SO. */
const CATEGORY_OPTIONS = [
  { value: 'all',       label: 'All categories' },
  { value: 'sofa',      label: 'Sofa' },
  { value: 'bedframe',  label: 'Bedframe' },
  { value: 'mattress',  label: 'Mattress' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'service',   label: 'Service' },
] as const;

/** Which date field the range filter targets (PO has PO Date + Expected). */
const DATE_FIELD_OPTIONS = [
  { value: 'poDate',   label: 'PO Date' },
  { value: 'expected', label: 'Expected Delivery' },
] as const;
type DateField = typeof DATE_FIELD_OPTIONS[number]['value'];

const rowDateFor = (r: OutstandingPoItem, field: DateField): string | null =>
  field === 'poDate' ? (r.poDate ?? null) : (r.expectedAt ?? null);

type Pick = { picked: boolean; qty: number };

export const GrnFromPo = () => {
  const navigate = useNavigate();
  const itemsQ   = useOutstandingPoItems();
  const create   = useCreateGrnsFromPoItems();

  // Map<poItemId, { picked, qty }>. qty defaults to remainingQty when ticked.
  const [picks, setPicks] = useState<Record<string, Pick>>({});

  // GRN received date — the only GRN-specific default (PO-from-SO derives its
  // dates server-side; GRN needs the receipt date). Defaults to today.
  const [receivedDate, setReceivedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Toolbar filters — identical to Create-PO-from-SO.
  const [category, setCategory]   = useState<string>('all');
  const [dateField, setDateField] = useState<DateField>('poDate');
  const [dateFrom, setDateFrom]   = useState<string>('');
  const [dateTo, setDateTo]       = useState<string>('');

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

  const selectAll = () =>
    setPicks((s) => {
      const next = { ...s };
      for (const l of rows) next[l.poItemId] = { picked: true, qty: l.remainingQty };
      return next;
    });

  const clearAll = () => setPicks({});

  const picked = Object.entries(picks).filter(([, v]) => v.picked && v.qty > 0);
  const pickedCount = picked.length;
  /* One GRN per PO (grns.purchase_order_id is a single FK) → different
     suppliers are NEVER merged into one GRN. Surface the resulting GRN count
     so the split is obvious before saving (Commander 2026-05-29). */
  const pickedIds = useMemo(() => new Set(picked.map(([id]) => id)), [picked]);
  const grnCount = useMemo(
    () => new Set(items.filter((r) => pickedIds.has(r.poItemId)).map((r) => r.poId)).size,
    [items, pickedIds],
  );

  // ── Columns — mirror Create-PO-from-SO (PO Doc No / Supplier / Category /
  //    Item Code / Description+variants / Ordered / Received / Pick Qty /
  //    Expected / Line Value). Memoized on `picks` so the controlled inputs
  //    re-render when pick state changes (DataGrid is React.memo'd). ────────
  const columns = useMemo<DataGridColumn<OutstandingPoItem>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => {
        const on = Boolean(picks[r.poItemId]?.picked);
        return (
          <input
            type="checkbox"
            checked={on}
            onChange={() => togglePick(r.poItemId, r.remainingQty)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Pick ${r.itemCode}`}
          />
        );
      },
    },
    {
      key: 'poDocNo', label: 'PO Doc No', width: 120, sortable: true, groupable: true,
      accessor: (r) => <span className={styles.codeCell}>{r.poDocNo}</span>,
      searchValue: (r) => r.poDocNo,
    },
    {
      key: 'supplier', label: 'Supplier', width: 200, sortable: true, groupable: true,
      accessor: (r) => <span>{r.supplierCode}{r.supplierName ? ` · ${r.supplierName}` : ''}</span>,
      searchValue: (r) => `${r.supplierCode ?? ''} ${r.supplierName ?? ''}`.trim(),
      groupValue: (r) => r.supplierName ?? r.supplierCode ?? '(none)',
    },
    {
      key: 'itemGroup', label: 'Category', width: 110, sortable: true, groupable: true,
      accessor: (r) => <ItemGroupPill group={r.itemGroup} />,
      searchValue: (r) => r.itemGroup ?? '',
      groupValue: (r) => (r.itemGroup ?? '(none)').toUpperCase(),
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
      key: 'qty', label: 'Ordered', width: 80, align: 'right', sortable: true,
      accessor: (r) => String(r.qty),
      sortFn: (a, b) => a.qty - b.qty,
    },
    {
      key: 'receivedQty', label: 'Received', width: 80, align: 'right', sortable: true,
      accessor: (r) => <span className={styles.muted}>{r.receivedQty}</span>,
      sortFn: (a, b) => a.receivedQty - b.receivedQty,
    },
    {
      key: 'pickQty', label: 'Pick Qty', width: 90, align: 'right', sortable: false, groupable: false,
      accessor: (r) => {
        const p = picks[r.poItemId];
        const on = Boolean(p?.picked);
        return (
          <input
            type="number"
            min={0}
            max={r.remainingQty}
            value={on ? p!.qty : ''}
            placeholder={String(r.remainingQty)}
            /* Typing a qty auto-selects the row (no need to tick first). */
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setQty(r.poItemId, Math.min(r.remainingQty, Math.max(0, Number(e.target.value) || 0)))}
            style={{ ...FILTER_INPUT, width: 64, textAlign: 'right' }}
          />
        );
      },
    },
    {
      key: 'expectedAt', label: 'Expected', width: 120, sortable: true,
      accessor: (r) => r.expectedAt ?? '',
      searchValue: (r) => r.expectedAt ?? '',
      sortFn: (a, b) => String(a.expectedAt ?? '').localeCompare(String(b.expectedAt ?? '')),
    },
    {
      key: 'lineValue', label: 'Line Value', width: 120, align: 'right', sortable: true,
      accessor: (r) => {
        const p = picks[r.poItemId];
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

  // ── Create GRNs ──────────────────────────────────────────────────────
  const onSave = () => {
    if (pickedCount === 0) { window.alert('Tick at least one PO line first.'); return; }
    if (!receivedDate)     { window.alert('Received Date is required.'); return; }
    const body = {
      picks: picked.map(([poItemId, v]) => ({ poItemId, qty: v.qty })),
      receivedDate,
    };
    create.mutate(body, {
      onSuccess: (res) => {
        if (!res.total) {
          window.alert('No GRNs created — the picked lines had nothing receivable.');
          return;
        }
        const summary = res.created.map((g) => g.grnNumber).join(', ');
        window.alert(`Created ${res.total} GRN${res.total === 1 ? '' : 's'}: ${summary}\nInventory updated.`);
        navigate('/grns');
      },
      onError: (err) => window.alert(`Create failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  // ── Toolbar (filters + select/clear + received date) — same layout as
  //    Create-PO-from-SO, plus the GRN-specific Received Date. ─────────────
  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      <Button variant="ghost" size="sm" onClick={selectAll} disabled={rows.length === 0}>
        <CheckSquare {...ICON} /> Select all
      </Button>
      <Button variant="ghost" size="sm" onClick={clearAll} disabled={pickedCount === 0}>
        <Square {...ICON} /> Clear all
      </Button>

      <span style={{ width: 1, height: 20, background: 'var(--line)' }} aria-hidden />

      <span style={{ fontSize: 'var(--fs-11)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
        Received
      </span>
      <input
        type="date"
        value={receivedDate}
        onChange={(e) => setReceivedDate(e.target.value)}
        style={FILTER_INPUT}
        aria-label="Received date"
      />

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

      {/* Date-range filter */}
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
          <Link to="/grns" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Goods Receipts</span>
          </Link>
          <h1 className={styles.title}>Create GRN from Purchase Orders</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/grns')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || pickedCount === 0 || !receivedDate}
            title="One GRN per PO — different suppliers are never merged into one GRN."
          >
            <Save {...ICON} />
            {create.isPending
              ? 'Creating…'
              : pickedCount === 0
                ? 'Pick at least 1 line'
                : !receivedDate
                  ? 'Set received date'
                  : `Create ${grnCount} GRN${grnCount === 1 ? '' : 's'} (${pickedCount} line${pickedCount === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>

      <DataGrid<OutstandingPoItem>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.poItemId}
        searchPlaceholder="Search PO, supplier, item…"
        onRowClick={(r) => togglePick(r.poItemId, r.remainingQty)}
        toolbar={toolbar}
        groupBanner={false}
        isLoading={itemsQ.isLoading}
        emptyMessage="No outstanding PO lines — every line has been received (or there are no outstanding POs)."
      />
    </div>
  );
};
