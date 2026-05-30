// ----------------------------------------------------------------------------
// GrnFromPo — multi-select PO LINE → New GRN form FEEDER.
//
// Commander 2026-05-29 redesign: this picker no longer auto-creates GRNs. Like
// Create-PO-from-SO (PurchaseOrderFromSo), it now FEEDS the New GRN form — tick
// the outstanding PO lines you're receiving, optionally adjust the Pick Qty,
// hit "Add N lines to GRN", and you land back on /grns/new with those lines
// pre-loaded (supplier locked, each line keeping its own purchase_order_item_id
// so received_qty still rolls up to every source PO).
//
// Same shared <DataGrid> primitive + toolbar (Select all / Clear all + category
// filter + date-range filter targeting PO Date / Expected Delivery + search +
// Columns config) + dense ledger columns with the variant summary under each
// Description + click-row-to-pick + editable Pick Qty. One supplier per GRN:
// once a line is ticked, other suppliers' lines grey out + disable.
//
// Routing: /grns/from-po.
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X, CheckSquare, Square, Filter } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { VariantDescription } from '../components/VariantDescription';
import {
  useOutstandingPoItems,
  type OutstandingPoItem,
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

/* Shape stashed to sessionStorage for the New GRN form to consume. Mirrors the
   poFromSoPicks pattern — the full row plus the chosen pick qty. */
export type GrnFromPoPick = OutstandingPoItem & { _pickQty: number };

export const GrnFromPo = () => {
  const navigate = useNavigate();
  const itemsQ   = useOutstandingPoItems();

  // Map<poItemId, { picked, qty }>. qty defaults to remainingQty when ticked.
  const [picks, setPicks] = useState<Record<string, Pick>>({});

  // Toolbar filters — identical to Create-PO-from-SO.
  const [category, setCategory]   = useState<string>('all');
  const [dateField, setDateField] = useState<DateField>('poDate');
  const [dateFrom, setDateFrom]   = useState<string>('');
  const [dateTo, setDateTo]       = useState<string>('');

  // In-app result dialog (validation only now — the grid feeds the form).
  const [dialog, setDialog] = useState<{ title: string; body: string; goTo?: string } | null>(null);

  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);

  /* The New GRN form stashes its current draft (grnNewDraft) before sending us
     here. Build a per-poItemId drafted-qty map so the same PO line can't be
     picked twice across the unsaved draft + these new picks:
       · lines FULLY consumed by the draft are filtered out,
       · lines PARTIALLY consumed still show with a "in draft X" tag, and the
         Pick Qty is capped at (remaining − draft). Mirrors PurchaseOrderFromSo. */
  const draftQtyById = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('grnNewDraft');
      if (!raw) return new Map<string, number>();
      const d = JSON.parse(raw) as { lines?: Array<{ purchaseOrderItemId?: string | null; qtyReceived?: number }> };
      const m = new Map<string, number>();
      for (const l of (d.lines ?? [])) {
        if (!l.purchaseOrderItemId) continue;
        m.set(l.purchaseOrderItemId, (m.get(l.purchaseOrderItemId) ?? 0) + (l.qtyReceived ?? 0));
      }
      return m;
    } catch { return new Map<string, number>(); }
  }, []);

  /* Effective remaining for a row, after subtracting what the unsaved draft
     already holds for this same PO line. <=0 → filtered out. */
  const effRemaining = (r: OutstandingPoItem): number =>
    r.remainingQty - (draftQtyById.get(r.poItemId) ?? 0);

  // ── Filtered rows fed to the grid ────────────────────────────────────
  const rows = useMemo(() => {
    return items.filter((r) => {
      if (effRemaining(r) <= 0) return false;
      if (category !== 'all' && (r.itemGroup ?? '').toLowerCase() !== category) return false;
      if (dateFrom || dateTo) {
        const d = rowDateFor(r, dateField);
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo   && d > dateTo)   return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, draftQtyById, category, dateField, dateFrom, dateTo]);

  // One WAREHOUSE per GRN (Commander 2026-05-30) — once a line is ticked, the
  // selection locks to that PO line's warehouse (purchase_location). Lines from a
  // DIFFERENT warehouse grey out / become un-tickable. Mirrors the supplier-lock
  // pattern in PurchaseOrderFromSo, but keyed on warehouseLocationId. Clearing
  // all picks unlocks.
  const lockedWarehouse = useMemo(() => {
    for (const [id, v] of Object.entries(picks)) {
      if (!v.picked) continue;
      const row = items.find((r) => r.poItemId === id);
      if (row?.warehouseLocationId) return row.warehouseLocationId;
    }
    return null;
  }, [picks, items]);

  // Human-readable label for the locked warehouse (for the header note).
  const lockedWarehouseLabel = useMemo(() => {
    if (!lockedWarehouse) return null;
    const row = items.find((r) => r.warehouseLocationId === lockedWarehouse);
    return row?.warehouseLocationName ?? row?.warehouseLocationCode ?? lockedWarehouse;
  }, [lockedWarehouse, items]);

  // A row is LOCKED when a different warehouse is already picked. Grey these out
  // + disable their checkbox / qty input.
  const isRowLocked = (r: OutstandingPoItem): boolean =>
    Boolean(lockedWarehouse && r.warehouseLocationId !== lockedWarehouse
      && !picks[r.poItemId]?.picked);

  // ── Pick helpers ─────────────────────────────────────────────────────
  const togglePick = (id: string, remaining: number) => {
    const row = items.find((r) => r.poItemId === id);
    // Block ticking a different warehouse than the one already locked.
    if (row && lockedWarehouse && row.warehouseLocationId !== lockedWarehouse
        && !picks[id]?.picked) return;
    setPicks((s) => ({
      ...s,
      [id]: s[id]?.picked
        ? { picked: false, qty: 0 }
        : { picked: true, qty: s[id]?.qty || remaining },
    }));
  };

  const setQty = (id: string, qty: number) =>
    setPicks((s) => ({ ...s, [id]: { picked: true, qty } }));

  // Select / clear all currently-VISIBLE rows (respects filters + warehouse lock).
  const selectAll = () =>
    setPicks((s) => {
      const next = { ...s };
      // Lock to the first visible warehouse so a bulk select stays one-warehouse.
      const lockTo = lockedWarehouse ?? rows[0]?.warehouseLocationId ?? null;
      for (const l of rows) {
        if (lockTo && l.warehouseLocationId !== lockTo) continue;
        next[l.poItemId] = { picked: true, qty: effRemaining(l) };
      }
      return next;
    });

  const clearAll = () => setPicks({});

  const picked = Object.entries(picks).filter(([, v]) => v.picked && v.qty > 0);
  const pickedCount = picked.length;

  // ── Columns — mirror Create-PO-from-SO (PO Doc No / Supplier / Category /
  //    Item Code / Description+variants / Ordered / Received / Pick Qty /
  //    Expected / Line Value). Memoized on `picks` so the controlled inputs
  //    re-render when pick state changes (DataGrid is React.memo'd). ────────
  const columns = useMemo<DataGridColumn<OutstandingPoItem>[]>(() => [
    {
      key: 'pick', label: '', width: 40, sortable: false, groupable: false,
      accessor: (r) => {
        const on = Boolean(picks[r.poItemId]?.picked);
        const locked = isRowLocked(r);
        return (
          <input
            type="checkbox"
            checked={on}
            disabled={locked}
            onChange={() => togglePick(r.poItemId, effRemaining(r))}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Pick ${r.itemCode}`}
            style={locked ? { cursor: 'not-allowed' } : undefined}
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
      /* Warehouse column (Deliverable 4b) — each PO line's purchase_location.
         The GRN locks to one warehouse; this column makes the lock legible. */
      key: 'warehouse', label: 'Warehouse', width: 150, sortable: true, groupable: true,
      accessor: (r) => (
        <span className={styles.muted}>
          {r.warehouseLocationCode
            ? `${r.warehouseLocationCode}${r.warehouseLocationName ? ` · ${r.warehouseLocationName}` : ''}`
            : '—'}
        </span>
      ),
      searchValue: (r) => `${r.warehouseLocationCode ?? ''} ${r.warehouseLocationName ?? ''}`.trim(),
      groupValue: (r) => r.warehouseLocationName ?? r.warehouseLocationCode ?? '(no warehouse)',
      sortFn: (a, b) => (a.warehouseLocationCode ?? '').localeCompare(b.warehouseLocationCode ?? ''),
    },
    {
      /* PO Date — available in the Columns toggle; hidden by default to keep the
         picker dense. (Deliverable 4c.) */
      key: 'poDate', label: 'PO Date', width: 120, sortable: true, defaultHidden: true,
      accessor: (r) => r.poDate ?? '',
      searchValue: (r) => r.poDate ?? '',
      sortFn: (a, b) => String(a.poDate ?? '').localeCompare(String(b.poDate ?? '')),
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
      accessor: (r) => (
        <VariantDescription
          itemCode={r.itemCode}
          itemGroup={r.itemGroup}
          variants={r.variants}
          description={r.description}
          mutedClassName={styles.muted}
        />
      ),
      searchValue: (r) => r.description ?? '',
    },
    {
      key: 'qty', label: 'Ordered', width: 80, align: 'right', sortable: true,
      accessor: (r) => String(r.qty),
      sortFn: (a, b) => a.qty - b.qty,
    },
    {
      key: 'receivedQty', label: 'Received', width: 80, align: 'right', sortable: true,
      accessor: (r) => {
        const inDraft = draftQtyById.get(r.poItemId) ?? 0;
        return (
          <span className={styles.muted}>
            {r.receivedQty}
            {inDraft > 0 && (
              <span style={{ display: 'block', fontSize: 'var(--fs-11)', color: 'var(--c-burnt)' }}>
                in draft {inDraft}
              </span>
            )}
          </span>
        );
      },
      sortFn: (a, b) => a.receivedQty - b.receivedQty,
    },
    {
      key: 'pickQty', label: 'Pick Qty', width: 90, align: 'right', sortable: false, groupable: false,
      accessor: (r) => {
        const p = picks[r.poItemId];
        const on = Boolean(p?.picked);
        const locked = isRowLocked(r);
        const eff = effRemaining(r);
        return (
          <input
            type="number"
            min={0}
            max={eff}
            value={on ? p!.qty : ''}
            placeholder={String(eff)}
            disabled={locked}
            /* Typing a qty auto-selects the row (no need to tick first). */
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              setQty(r.poItemId, Math.min(eff, Math.max(0, Number(e.target.value) || 0)))}
            style={{ ...FILTER_INPUT, width: 64, textAlign: 'right', ...(locked ? { cursor: 'not-allowed', background: 'var(--c-cream)' } : null) }}
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
        const pickQty = p?.picked ? p.qty : effRemaining(r);
        return (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
            {fmtRm(pickQty * r.unitPriceCenti)}
          </span>
        );
      },
      sortFn: (a, b) => a.remainingQty * a.unitPriceCenti - b.remainingQty * b.unitPriceCenti,
    },
  ], [picks]);

  // ── Add to GRN ───────────────────────────────────────────────────────
  // Commander 2026-05-29 — this grid FEEDS the New GRN form (no longer auto-
  // creates GRNs). On confirm, stash the picked PO lines + their chosen qty,
  // then return to /grns/new, which loads them as GRN line items.
  const onSave = () => {
    if (pickedCount === 0) { setDialog({ title: 'Nothing picked', body: 'Tick at least one PO line first.' }); return; }
    const out: GrnFromPoPick[] = picked
      .map(([poItemId, v]) => {
        const row = items.find((r) => r.poItemId === poItemId);
        return row ? { ...row, _pickQty: v.qty } : null;
      })
      .filter((x): x is GrnFromPoPick => x !== null);
    try { sessionStorage.setItem('grnFromPoPicks', JSON.stringify(out)); } catch { /* quota */ }
    navigate('/grns/new');
  };

  // ── Toolbar (filters + select/clear) — same layout as Create-PO-from-SO.
  //    Received date is now set on the New GRN form, not here. ──────────────
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
          <h1 className={styles.title}>Pick PO lines for this GRN</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/grns')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={pickedCount === 0}
            title="Add the picked PO lines into the New GRN form"
          >
            <Save {...ICON} />
            {pickedCount === 0 ? 'Pick at least 1 line' : `Add ${pickedCount} line${pickedCount === 1 ? '' : 's'} to GRN`}
          </Button>
        </div>
      </div>
      {lockedWarehouse && (
        <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          One warehouse per GRN — locked to{' '}
          <code>{lockedWarehouseLabel}</code>. PO lines from a different warehouse
          are greyed out; clear picks to switch.
        </p>
      )}

      <DataGrid<OutstandingPoItem>
        rows={rows}
        columns={columns}
        storageKey={STORAGE_KEY}
        rowKey={(r) => r.poItemId}
        searchPlaceholder="Search PO, supplier, item…"
        onRowClick={(r) => togglePick(r.poItemId, effRemaining(r))}
        /* Grey out rows whose supplier conflicts with the locked one. */
        rowStyle={(r) => isRowLocked(r)
          ? { opacity: 0.45, background: 'var(--c-cream)', cursor: 'not-allowed' }
          : undefined}
        toolbar={toolbar}
        groupBanner={false}
        isLoading={itemsQ.isLoading}
        emptyMessage="No outstanding PO lines — every line has been received (or there are no outstanding POs)."
      />

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          primaryLabel={dialog.goTo ? 'Open Goods Receipts' : undefined}
          onPrimary={dialog.goTo ? () => { const g = dialog.goTo!; setDialog(null); navigate(g); } : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
