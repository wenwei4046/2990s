// ----------------------------------------------------------------------------
// Purchase Orders (manufacturer-side).
//
// 简洁版第一版:
//   - List 所有 PO,按 status 过滤
//   - "New PO" → 选 supplier → 列出 supplier 的 bindings → 给每条填 qty →
//     POST /mfg-purchase-orders
//   - 列表行点击 → 显示 PO detail(items + 状态 actions: Submit/Cancel)
//
// 没做(后续):GRN 收货、3-way match、PDF 打印、邮件发送。
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, X, FileText, Printer, Truck, Package, Search, Edit3 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  usePurchaseOrders,
  usePurchaseOrderDetail,
  useCreatePurchaseOrder,
  useCancelPurchaseOrder,
  useSuppliers,
  useSupplierDetail,
  useSuppliersForMaterial,
  type PoStatus,
  type PoHeaderRow,
  type BindingRow,
  type Currency,
  type NewPoItem,
  type MaterialKind,
} from '../lib/suppliers-queries';
import { useMfgProducts, type MfgProductRow } from '../lib/mfg-products-queries';
import { useGrnFromPos } from '../lib/flow-queries';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// PR — Commander 2026-05-27: filter pills collapsed from 6 → 2. The buyer's
// 95% view is "what still has stuff coming in" (Outstanding), so default to
// that. "All" stays as the escape hatch when chasing closed/cancelled history.
// Outstanding = SUBMITTED ∪ PARTIALLY_RECEIVED. Filtered client-side since the
// API supports only one status at a time.
type StatusFilter = 'all' | 'outstanding';
const STATUS_CHIPS: { value: StatusFilter; label: string }[] = [
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'all', label: 'All' },
];

const STATUS_COLOR: Record<PoStatus, string> = {
  // DRAFT removed in migration 0078.
  SUBMITTED: 'rgba(31, 58, 138, 0.10)',
  PARTIALLY_RECEIVED: 'rgba(232, 107, 58, 0.10)',
  RECEIVED: 'rgba(47, 93, 79, 0.12)',
  CANCELLED: 'rgba(184, 51, 31, 0.10)',
};

const fmtMoney = (centi: number, currency: Currency): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** PR — Commander 2026-05-27: per-row items preview, AutoCount style. Shows
    first 3 items as `CODE×qty · CODE×qty · +N more`. Returns null when the
    PO has no items so caller can render the muted "—". */
const summarizeItems = (items: PoHeaderRow['items']): string | null => {
  if (!items || items.length === 0) return null;
  const HEAD = 3;
  const shown = items.slice(0, HEAD)
    .map((it) => `${it.material_code}×${it.qty}`)
    .join(' · ');
  const extra = items.length - HEAD;
  return extra > 0 ? `${shown} · +${extra} more` : shown;
};

/* localStorage key for the PO list's DataGrid column layout (order / hidden /
   widths / sort / grouping). Stable id so commander's column prefs survive
   reloads — same persistence the SO list + GRN list already use. */
const PO_LIST_STORAGE_KEY = 'po-list.layout.v1';

/* buildPoColumns — declared as a function so the component can pass fresh
   selection state (selectedIds + toggleSelect) every render. Memoized inside
   the component so DataGrid's column memo only invalidates when the selection
   set actually changes. Columns mirror the plain table this replaced:
   leading checkbox · PO No. · Supplier · Items · Date · Expected · Currency ·
   Total · Status. */
const buildPoColumns = (
  selectedIds: Set<string>,
  toggleSelect: (id: string) => void,
): DataGridColumn<PoHeaderRow>[] => [
  {
    /* Leading multi-select checkbox for batch GRN conversion. stopPropagation
       so ticking a row doesn't also fire the grid's row-click navigation. */
    key: 'select', label: '', width: 40, minWidth: 36,
    sortable: false, groupable: false,
    accessor: (po) => (
      <input
        type="checkbox"
        aria-label={`Select PO ${po.po_number}`}
        checked={selectedIds.has(po.id)}
        onChange={() => toggleSelect(po.id)}
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: 'pointer' }}
      />
    ),
    searchValue: () => '',
  },
  {
    key: 'po_number', label: 'PO No.', width: 150, sortable: true,
    accessor: (po) => <span className={styles.codeChip}>{po.po_number}</span>,
    searchValue: (po) => po.po_number,
    sortFn: (a, b) => a.po_number.localeCompare(b.po_number),
  },
  {
    key: 'supplier', label: 'Supplier', width: 200, sortable: true, groupable: true,
    accessor: (po) => po.supplier?.name ?? po.supplier?.code ?? '—',
    searchValue: (po) => `${po.supplier?.name ?? ''} ${po.supplier?.code ?? ''}`,
    groupValue: (po) => po.supplier?.name ?? po.supplier?.code ?? '(none)',
    sortFn: (a, b) =>
      (a.supplier?.name ?? a.supplier?.code ?? '').localeCompare(b.supplier?.name ?? b.supplier?.code ?? ''),
  },
  {
    /* Items preview between Supplier and Date so the buyer reads each PO
       without drilling in (Commander 2026-05-27). Hover title shows the full
       list. */
    key: 'items', label: 'Items', width: 320, sortable: false, groupable: false,
    accessor: (po) => {
      const summary = summarizeItems(po.items);
      return (
        <span
          title={(po.items ?? []).map((it) => `${it.material_code} × ${it.qty}`).join('\n')}
          style={{
            display: 'block',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-12)',
            color: summary ? 'var(--c-ink)' : 'var(--fg-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {summary ?? '—'}
        </span>
      );
    },
    searchValue: (po) => (po.items ?? []).map((it) => `${it.material_code} ${it.qty}`).join(' '),
  },
  {
    key: 'po_date', label: 'Date', width: 110, sortable: true,
    accessor: (po) => po.po_date,
    searchValue: (po) => po.po_date,
    sortFn: (a, b) => (a.po_date ?? '').localeCompare(b.po_date ?? ''),
  },
  {
    key: 'expected_at', label: 'Expected', width: 110, sortable: true,
    accessor: (po) => po.expected_at ?? '—',
    searchValue: (po) => po.expected_at ?? '',
    sortFn: (a, b) => (a.expected_at ?? '').localeCompare(b.expected_at ?? ''),
  },
  {
    key: 'currency', label: 'Currency', width: 90, sortable: true, groupable: true,
    accessor: (po) => po.currency,
    searchValue: (po) => po.currency,
    groupValue: (po) => po.currency,
  },
  {
    key: 'total_centi', label: 'Total', width: 130, sortable: true, align: 'right', groupable: false,
    accessor: (po) => (
      <span style={{ fontFamily: 'var(--font-mark)', color: 'var(--c-burnt)', fontWeight: 800 }}>
        {fmtMoney(po.total_centi, po.currency)}
      </span>
    ),
    searchValue: (po) => fmtMoney(po.total_centi, po.currency),
    sortFn: (a, b) => a.total_centi - b.total_centi,
  },
  {
    key: 'status', label: 'Status', width: 150, sortable: true, groupable: true,
    accessor: (po) => (
      <span className={styles.statusPill} style={{ background: STATUS_COLOR[po.status] }}>
        {po.status.replace('_', ' ')}
      </span>
    ),
    searchValue: (po) => po.status.replace('_', ' '),
    groupValue: (po) => po.status,
    sortFn: (a, b) => a.status.localeCompare(b.status),
  },
];

type Drawer =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'detail'; poId: string };

export const PurchaseOrders = () => {
  // PR — default to Outstanding (the 95% view).
  const [status, setStatus] = useState<StatusFilter>('outstanding');
  const [drawer, setDrawer] = useState<Drawer>({ kind: 'closed' });
  const navigate = useNavigate();
  // Multi-select state — batch-convert N POs into one GRN.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const grnFromPos = useGrnFromPos();
  const cancelPo = useCancelPurchaseOrder();

  // Always fetch all rows — filtering Outstanding (SUBMITTED ∪
  // PARTIALLY_RECEIVED) client-side is one trip vs. two and the dataset is
  // small (4-staff org).
  const { data, isLoading, error } = usePurchaseOrders();
  const rows = useMemo(() => {
    const all = data ?? [];
    if (status === 'all') return all;
    return all.filter((r) => r.status === 'SUBMITTED' || r.status === 'PARTIALLY_RECEIVED');
  }, [data, status]);

  const toggleSelect = (id: string) => {
    setSelectedIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => rows.filter((r) => selectedIds.has(r.id)),
    [rows, selectedIds],
  );
  const selectedSuppliers = useMemo(
    () => new Set(selectedRows.map((r) => r.supplier_id)),
    [selectedRows],
  );

  // Memoized columns — only invalidates when the selection set changes, so
  // DataGrid's prop-memo keeps the sort/filter/group pipeline warm on typing.
  const columns = useMemo(
    () => buildPoColumns(selectedIds, toggleSelect),
    [selectedIds],
  );

  const convertToGrn = () => {
    if (selectedRows.length === 0) return;
    if (selectedSuppliers.size > 1) {
      alert('All selected POs must be from the same supplier. Convert per supplier in separate batches.');
      return;
    }
    grnFromPos.mutate(
      { purchaseOrderIds: [...selectedIds] },
      {
        onSuccess: (res) => {
          /* Commander 2026-05-29 — "为什么没有跳进 GR 的界面先": after converting,
             go STRAIGHT into the new GRN detail page (no blocking alert, no PO
             drawer). The GRN page shows its own number. */
          setSelectedIds(new Set());
          navigate(`/grns/${res.id}`);
        },
        onError: (e) => alert(`Convert to GRN failed: ${e instanceof Error ? e.message : String(e)}`),
      },
    );
  };

  /* Commander 2026-05-29 — right-click context menu actions (mirrors the SO
     list). Single-PO convert reuses the batch GRN endpoint. */
  const convertOneToGrn = (po: PoHeaderRow) => {
    // Commander 2026-05-30 — "Convert to GRN" is ALWAYS shown in the menu; when
    // the PO has no goods left inbound (already fully received / cancelled),
    // tell the operator plainly instead of silently doing nothing.
    if (po.status !== 'SUBMITTED' && po.status !== 'PARTIALLY_RECEIVED') {
      window.alert('Nothing to be converted — this Purchase Order has no goods left to receive (already fully received or cancelled).');
      return;
    }
    grnFromPos.mutate(
      { purchaseOrderIds: [po.id] },
      {
        // Jump straight into the created GRN (Commander 2026-05-29).
        onSuccess: (res) => navigate(`/grns/${res.id}`),
        onError: (e) => alert(`Convert to GRN failed: ${e instanceof Error ? e.message : String(e)}`),
      },
    );
  };
  const doCancelPo = (po: PoHeaderRow) => {
    if (!window.confirm(`Cancel ${po.po_number}? It will stop proceeding and any converted SO lines are released back.`)) return;
    cancelPo.mutate(po.id, {
      onError: (e) => alert(`Cancel failed: ${e instanceof Error ? e.message : String(e)}`),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Purchase Orders</h1>
          <p className={styles.subtitle}>Manufacturer POs to suppliers</p>
        </div>
        {/* PR #97 — Commander 2026-05-26: "Create PO 也要像这样子啊"
            Replaced the old side-drawer with a full-page AutoCount-style
            form at /purchase-orders/new. */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {/* PR — Phase 1: multi-SO → PO picker. Lets commander select
              outstanding SO lines (across customers + suppliers), input
              partial qty per line, and emit one PO per supplier. */}
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-orders/from-so')}>
            <Plus {...ICON} />
            <span>From SO</span>
          </Button>
          <Button variant="primary" size="md" onClick={() => navigate('/purchase-orders/new')}>
            <Plus {...ICON} />
            <span>New PO</span>
          </Button>
        </div>
      </div>

      <div className={styles.statusChips}>
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setStatus(c.value)}
            style={{
              fontFamily: 'var(--font-button)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-pill)',
              border: status === c.value ? '1px solid var(--c-ink)' : '1px solid var(--line)',
              background: status === c.value ? 'var(--c-ink)' : 'var(--c-paper)',
              color: status === c.value ? 'var(--c-cream)' : 'var(--c-ink)',
              cursor: 'pointer',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading POs…' : `${rows.length} purchase orders`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load POs.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(232, 107, 58, 0.08)',
          border: '1px solid var(--c-orange)',
          borderRadius: 'var(--radius-md)',
          gap: 'var(--space-3)',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--c-burnt)' }}>
            {selectedIds.size} selected
            {selectedSuppliers.size > 1 && ' · ⚠️ Mixed suppliers — narrow to one to convert'}
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            <Button variant="primary" size="sm"
              onClick={convertToGrn}
              disabled={grnFromPos.isPending || selectedSuppliers.size !== 1}>
              {grnFromPos.isPending ? 'Converting…' : `Convert to GRN (${selectedIds.size})`}
            </Button>
          </span>
        </div>
      )}

      <DataGrid<PoHeaderRow>
        rows={rows}
        columns={columns}
        storageKey={PO_LIST_STORAGE_KEY}
        rowKey={(po) => po.id}
        searchPlaceholder="Search POs…"
        /* Commander 2026-05-29 — open on DOUBLE-click (single-click was too
           trigger-happy: "本来应该要点两次的嘛"). Right-click → context menu. */
        onRowDoubleClick={(po) => navigate(`/purchase-orders/${po.id}`)}
        /* Cancelled POs grey out so they read as dead (mirrors the SO list). */
        rowStyle={(po) => po.status === 'CANCELLED'
          ? { opacity: 0.55, filter: 'grayscale(0.6)' }
          : undefined}
        contextMenu={(po) => {
          /* Tier 2 downstream-lock — once a non-cancelled GRN exists for this
             PO, hide Edit + Cancel. Convert-to-GRN STAYS visible because
             partial receiving (more GRNs) is allowed. */
          const hasChildren = Boolean(po.has_children);
          const menu: Array<{ label?: string; onClick?: () => void; danger?: boolean; divider?: true }> = [
            { label: 'View', onClick: () => navigate(`/purchase-orders/${po.id}`) },
          ];
          if (!hasChildren) {
            menu.push({ label: 'Edit', onClick: () => navigate(`/purchase-orders/${po.id}?edit=1`) });
          }
          menu.push({ divider: true as const });
          // Convert to GRN — ALWAYS shown (Commander 2026-05-30) so the operator
          // never thinks the action disappeared. convertOneToGrn decides at click
          // time whether the PO still has goods inbound and otherwise shows a
          // plain "Nothing to be converted" message.
          menu.push({ label: 'Convert to GRN', onClick: () => convertOneToGrn(po) });
          // Cancel — soft-stop. Hidden once already cancelled / received / locked.
          if (po.status !== 'CANCELLED' && po.status !== 'RECEIVED' && !hasChildren) {
            menu.push({ divider: true as const });
            menu.push({ label: 'Cancel PO', danger: true, onClick: () => doCancelPo(po) });
          }
          return menu;
        }}
        isLoading={isLoading}
        emptyMessage='No POs yet — click "New PO" to start.'
      />

      {/* PR #97 — Create-PO drawer removed; full-page form at /purchase-orders/new */}
      {drawer.kind === 'detail' && (
        <DetailPoDrawer poId={drawer.poId} onClose={() => setDrawer({ kind: 'closed' })} />
      )}
    </div>
  );
};

/* ─────────────────── Create PO Drawer ──────────────────────────────── */
//
// Two starting modes (commander 2026-05-25):
//   Mode "supplier" — pick supplier → list their bindings → tick + qty per row
//   Mode "item"     — pick a product → list suppliers that carry it → pick
//                     one → add to draft → can stack multiple items per PO
//                     as long as they all map to the SAME supplier.
//
// After items chosen, both modes converge into the same "header + summary"
// section: expected date, notes, currency (read-only from binding), submit.

type Mode = 'supplier' | 'item' | 'blank';
type PickedLine = { binding: BindingRow; qty: number };

const CreatePoDrawer = ({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (id: string, poNumber: string) => void;
}) => {
  const [mode, setMode] = useState<Mode>('blank');                       // PR #41 — default Blank Draft
  const [poDate, setPoDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const [blankSupplierId, setBlankSupplierId] = useState<string | null>(null);
  const create = useCreatePurchaseOrder();

  // ── Supplier-mode state ─────────────────────────────────────────────
  const suppliers = useSuppliers({ status: 'ACTIVE' });
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const supplierDetail = useSupplierDetail(supplierId);
  const supplierBindings = supplierDetail.data?.bindings ?? [];
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});

  // ── Item-mode state ─────────────────────────────────────────────────
  // User picks one product → we look up all suppliers for it → user picks
  // one binding row → adds (binding, qty) to itemModeLines.
  const [itemSearch, setItemSearch] = useState('');
  const itemModeProducts = useMfgProducts({ search: itemSearch.trim() || undefined });
  const [itemModeMaterial, setItemModeMaterial] = useState<{ kind: MaterialKind; code: string } | null>(null);
  const matSuppliers = useSuppliersForMaterial(
    itemModeMaterial?.kind ?? null,
    itemModeMaterial?.code ?? null,
  );
  const [itemModeLines, setItemModeLines] = useState<PickedLine[]>([]);
  // The supplier "locks" once the first item is added — subsequent items must
  // be from the same supplier (since one PO = one supplier).
  const lockedSupplierId = itemModeLines[0]?.binding.supplier_id ?? null;

  // ── Compute lines + totals ──────────────────────────────────────────
  const supplierModeLines: PickedLine[] = useMemo(
    () => supplierBindings.map((b) => ({ binding: b, qty: qtyMap[b.id] ?? 0 })).filter((r) => r.qty > 0),
    [supplierBindings, qtyMap],
  );
  const lines = mode === 'supplier' ? supplierModeLines : itemModeLines;
  const subtotalCenti = useMemo(
    () => lines.reduce((s, r) => s + r.qty * r.binding.unit_price_centi, 0),
    [lines],
  );
  const currency = lines[0]?.binding.currency ?? 'MYR';
  const finalSupplierId = mode === 'supplier' ? supplierId : lockedSupplierId;

  const setItemLineQty = (bindingId: string, qty: number) => {
    setItemModeLines((s) =>
      s.map((r) => (r.binding.id === bindingId ? { ...r, qty: Math.max(0, qty) } : r)).filter((r) => r.qty > 0),
    );
  };
  const removeItemLine = (bindingId: string) => {
    setItemModeLines((s) => s.filter((r) => r.binding.id !== bindingId));
  };

  const addItemBinding = (binding: BindingRow) => {
    if (lockedSupplierId && binding.supplier_id !== lockedSupplierId) {
      alert('All items in a PO must come from the same supplier. Start a new PO for a different supplier.');
      return;
    }
    if (itemModeLines.some((r) => r.binding.id === binding.id)) return;
    setItemModeLines((s) => [...s, { binding, qty: 1 }]);
    setItemModeMaterial(null);  // close the suppliers list, ready for next item
    setItemSearch('');
  };

  // PR #41 — mode='blank' supports raw PO creation (just supplier + dates).
  // User then adds items on the detail page with full per-category variants.
  const submit = () => {
    const supplierForBlank = mode === 'blank' ? blankSupplierId : finalSupplierId;
    if (!supplierForBlank) return alert('Pick a supplier first.');
    if (mode !== 'blank' && lines.length === 0) {
      return alert('Add at least one item with qty > 0 (or switch to Blank Draft to start raw).');
    }

    const items: NewPoItem[] = mode === 'blank' ? [] : lines.map((r) => ({
      materialKind: r.binding.material_kind,
      materialCode: r.binding.material_code,
      materialName: r.binding.material_name,
      supplierSku: r.binding.supplier_sku,
      qty: r.qty,
      unitPriceCenti: r.binding.unit_price_centi,
      bindingId: r.binding.id,
    }));
    create.mutate(
      {
        supplierId: supplierForBlank,
        currency: mode === 'blank' ? 'MYR' : currency,
        poDate,
        expectedAt: expectedAt || undefined,
        notes: notes || undefined,
        items,
      },
      {
        onSuccess: (res) => {
          // PR #41 — redirect to detail page so commander can add items
          // line-by-line with the per-category variant editor.
          onCreated(res.id, res.poNumber);
        },
      },
    );
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New Purchase Order</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>

        <div className={styles.drawerBody}>
          {/* ── Date + Mode picker ─────────────────────────────────── */}
          <div className={styles.section}>
            <p className={styles.eyebrow}>1. Date · How do you want to start?</p>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>PO Date</span>
                <input
                  type="date"
                  className={styles.fieldInput}
                  value={poDate}
                  onChange={(e) => setPoDate(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Expected Delivery</span>
                <input
                  type="date"
                  className={styles.fieldInput}
                  value={expectedAt}
                  onChange={(e) => setExpectedAt(e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <ModeChip active={mode === 'blank'} onClick={() => { setMode('blank'); setSupplierId(null); setItemModeLines([]); setQtyMap({}); }}>
                <Edit3 {...ICON} />
                <span>Blank Draft</span>
              </ModeChip>
              <ModeChip active={mode === 'supplier'} onClick={() => { setMode('supplier'); setItemModeLines([]); }}>
                <Truck {...ICON} />
                <span>From Supplier</span>
              </ModeChip>
              <ModeChip active={mode === 'item'} onClick={() => { setMode('item'); setSupplierId(null); setQtyMap({}); }}>
                <Package {...ICON} />
                <span>From Item</span>
              </ModeChip>
            </div>
          </div>

          {/* ── Blank Draft mode body (raw — SO-style) ─────────────── */}
          {mode === 'blank' && (
            <div className={styles.section}>
              <p className={styles.eyebrow}>2. Pick Supplier (items added on the detail page)</p>
              <select
                className={styles.fieldSelect}
                value={blankSupplierId ?? ''}
                onChange={(e) => setBlankSupplierId(e.target.value || null)}
              >
                <option value="">— Select supplier —</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                ))}
              </select>
              <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Blank Draft: PO is created with just supplier + dates. You add line items
                on the PO detail page — including per-category variants (sofa color,
                bedframe divan / leg / special). Mirrors the Sales Order flow.
              </p>
            </div>
          )}

          {/* ── Supplier mode body ─────────────────────────────────── */}
          {mode === 'supplier' && (
            <>
              <div className={styles.section}>
                <p className={styles.eyebrow}>2. Pick Supplier</p>
                <select
                  className={styles.fieldSelect}
                  value={supplierId ?? ''}
                  onChange={(e) => setSupplierId(e.target.value || null)}
                >
                  <option value="">— Select supplier —</option>
                  {suppliers.data?.map((s) => (
                    <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                  ))}
                </select>
              </div>

              {supplierId && (
                <div className={styles.section}>
                  <p className={styles.eyebrow}>3. Items the supplier carries — set qty per row</p>
                  {supplierDetail.isLoading && <p>Loading bindings…</p>}
                  {supplierBindings.length === 0 && !supplierDetail.isLoading && (
                    <p className={styles.bannerWarn}>
                      This supplier has no material bindings yet. Add SKU mappings on the supplier detail page first.
                    </p>
                  )}
                  {supplierBindings.map((b) => (
                    <div key={b.id} className={styles.bindingRow}>
                      <span className={styles.bindingIcon}>·</span>
                      <div className={styles.bindingMaterial}>
                        <span className={styles.bindingCode}>{b.material_code}</span>
                        <span className={styles.bindingName}>{b.material_name}</span>
                      </div>
                      <span className={styles.bindingSku}>{b.supplier_sku}</span>
                      <span className={styles.bindingPrice}>{fmtMoney(b.unit_price_centi, b.currency)}</span>
                      <input
                        type="number"
                        min={0}
                        className={styles.fieldInput}
                        style={{ width: 80, textAlign: 'right' }}
                        placeholder="qty"
                        value={qtyMap[b.id] ?? ''}
                        onChange={(e) => setQtyMap((s) => ({ ...s, [b.id]: Math.max(0, Number(e.target.value) || 0) }))}
                      />
                      <span className={styles.bindingMeta}>
                        {qtyMap[b.id] ? fmtMoney(qtyMap[b.id]! * b.unit_price_centi, b.currency) : '—'}
                      </span>
                      <span />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Item mode body ─────────────────────────────────────── */}
          {mode === 'item' && (
            <>
              <div className={styles.section}>
                <p className={styles.eyebrow}>2. Search a Product → pick a Supplier</p>
                {lockedSupplierId && (
                  <p className={styles.eyebrow} style={{ color: 'var(--c-burnt)', marginBottom: 'var(--space-2)' }}>
                    Locked to supplier {(suppliers.data ?? []).find((s) => s.id === lockedSupplierId)?.name ?? lockedSupplierId} — all subsequent items must use the same supplier.
                  </p>
                )}
                <div style={{ position: 'relative' }}>
                  <Search {...ICON} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }} />
                  <input
                    type="search"
                    placeholder="Search product by code / description…"
                    value={itemSearch}
                    onChange={(e) => { setItemSearch(e.target.value); setItemModeMaterial(null); }}
                    className={styles.fieldInput}
                    style={{ width: '100%', paddingLeft: 'var(--space-7)' }}
                  />
                </div>
                {itemSearch.trim() && !itemModeMaterial && (
                  <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: 'var(--space-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
                    {(itemModeProducts.data ?? []).slice(0, 20).map((p: MfgProductRow) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setItemModeMaterial({ kind: 'mfg_product', code: p.code })}
                        style={{
                          width: '100%', textAlign: 'left',
                          padding: 'var(--space-2) var(--space-3)',
                          background: 'var(--c-paper)', border: 'none',
                          borderBottom: '1px solid var(--line)', cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-burnt)', fontWeight: 600 }}>{p.code}</span>{' '}
                        <span>{p.name}</span>
                        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', marginLeft: 8 }}>· {p.category}</span>
                      </button>
                    ))}
                    {(itemModeProducts.data ?? []).length === 0 && (
                      <p style={{ padding: 'var(--space-3)', color: 'var(--fg-muted)' }}>No matches.</p>
                    )}
                  </div>
                )}

                {itemModeMaterial && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <p className={styles.eyebrow} style={{ marginBottom: 'var(--space-2)' }}>
                      Suppliers that carry {itemModeMaterial.code}:
                    </p>
                    {matSuppliers.isLoading && <p>Loading…</p>}
                    {!matSuppliers.isLoading && (matSuppliers.data?.bindings ?? []).length === 0 && (
                      <p className={styles.bannerWarn}>
                        No supplier mappings for this item yet. Add it on a supplier's detail page first.
                      </p>
                    )}
                    {(matSuppliers.data?.bindings ?? []).map((b) => {
                      const disabled = Boolean(lockedSupplierId) && b.supplier_id !== lockedSupplierId;
                      return (
                        <div key={b.id} className={styles.bindingRow}
                          style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                          onClick={() => !disabled && addItemBinding(b)}
                          title={disabled ? 'Different supplier — start another PO' : 'Click to add to this PO'}
                        >
                          <span className={styles.bindingIcon}>
                            {b.is_main_supplier ? '★' : '·'}
                          </span>
                          <div className={styles.bindingMaterial}>
                            <span className={styles.bindingCode}>{b.supplier?.code ?? b.supplier_id.slice(0, 6)}</span>
                            <span className={styles.bindingName}>{b.supplier?.name ?? '—'}</span>
                          </div>
                          <span className={styles.bindingSku}>{b.supplier_sku}</span>
                          <span className={styles.bindingPrice}>{fmtMoney(b.unit_price_centi, b.currency)}</span>
                          <span className={styles.bindingMeta}>{b.lead_time_days}d lead</span>
                          <span className={styles.bindingMeta}>MOQ {b.moq}</span>
                          <Button variant="ghost" size="sm" disabled={disabled} onClick={(e) => { e.stopPropagation(); !disabled && addItemBinding(b); }}>
                            <Plus {...ICON} />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {itemModeLines.length > 0 && (
                <div className={styles.section}>
                  <p className={styles.eyebrow}>3. Items added to this PO ({itemModeLines.length})</p>
                  {itemModeLines.map((r) => (
                    <div key={r.binding.id} className={styles.bindingRow}>
                      <span className={styles.bindingIcon}>·</span>
                      <div className={styles.bindingMaterial}>
                        <span className={styles.bindingCode}>{r.binding.material_code}</span>
                        <span className={styles.bindingName}>{r.binding.material_name}</span>
                      </div>
                      <span className={styles.bindingSku}>{r.binding.supplier_sku}</span>
                      <span className={styles.bindingPrice}>{fmtMoney(r.binding.unit_price_centi, r.binding.currency)}</span>
                      <input
                        type="number" min={0}
                        className={styles.fieldInput}
                        style={{ width: 80, textAlign: 'right' }}
                        value={r.qty}
                        onChange={(e) => setItemLineQty(r.binding.id, Number(e.target.value) || 0)}
                      />
                      <span className={styles.bindingMeta}>
                        {fmtMoney(r.qty * r.binding.unit_price_centi, r.binding.currency)}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => removeItemLine(r.binding.id)}>
                        <X {...ICON} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Notes + Summary (shared across modes) ─────────────── */}
          {finalSupplierId && (
            <>
              <div className={styles.section}>
                <p className={styles.eyebrow}>Notes</p>
                <textarea
                  className={styles.fieldTextarea ?? styles.fieldInput}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  style={{ width: '100%' }}
                />
              </div>
              <div className={styles.section}>
                <p className={styles.eyebrow}>Summary</p>
                <p style={{ fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-24)', color: 'var(--c-burnt)', fontWeight: 800 }}>
                  Subtotal: {fmtMoney(subtotalCenti, currency)} · {lines.length} line items
                </p>
              </div>
            </>
          )}
        </div>

        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={create.isPending || !finalSupplierId || lines.length === 0}
          >
            {create.isPending ? 'Creating…' : 'Create PO (Draft)'}
          </Button>
        </footer>
      </aside>
    </>
  );
};

const ModeChip = ({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontFamily: 'var(--font-button)', fontSize: 'var(--fs-13)', fontWeight: 600,
      padding: 'var(--space-2) var(--space-4)',
      borderRadius: 'var(--radius-pill)',
      border: active ? '1px solid var(--c-ink)' : '1px solid var(--line)',
      background: active ? 'var(--c-ink)' : 'var(--c-paper)',
      color: active ? 'var(--c-cream)' : 'var(--c-ink)',
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
);

/* ─────────────────── Detail PO Drawer ──────────────────────────────── */

const DetailPoDrawer = ({ poId, onClose }: { poId: string; onClose: () => void }) => {
  const detail = usePurchaseOrderDetail(poId);
  // PR-DRAFT-removal — Submit/Cancel removed from the list drawer. Use
  // /purchase-orders/:id detail for cancel + delete actions.

  const po = detail.data?.purchaseOrder;
  const items = detail.data?.items ?? [];

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>
            {po?.po_number ?? 'Purchase Order'}
          </h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>

        <div className={styles.drawerBody}>
          {detail.isLoading && <p className={styles.eyebrow}>Loading…</p>}
          {po && (
            <>
              <div className={styles.section}>
                <p className={styles.eyebrow}>Supplier</p>
                <p style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--fs-20)', fontWeight: 700 }}>
                  {po.supplier?.name ?? po.supplier?.code}
                </p>
              </div>

              <div className={styles.formGrid}>
                <SmallStat label="PO Date" value={po.po_date} />
                <SmallStat label="Expected" value={po.expected_at ?? '—'} />
                <SmallStat label="Currency" value={po.currency} />
                <SmallStat label="Status" value={po.status.replace('_', ' ')} />
                <SmallStat label="Subtotal" value={fmtMoney(po.subtotal_centi, po.currency)} />
                <SmallStat label="Total" value={fmtMoney(po.total_centi, po.currency)} />
              </div>

              {po.notes && (
                <div className={styles.section}>
                  <p className={styles.eyebrow}>Notes</p>
                  <p>{po.notes}</p>
                </div>
              )}

              <div className={styles.section}>
                <p className={styles.eyebrow}>Items ({items.length})</p>
                {items.map((it) => (
                  <div key={it.id} className={styles.bindingRow}>
                    <span className={styles.bindingIcon}><FileText size={14} strokeWidth={1.75} /></span>
                    <div className={styles.bindingMaterial}>
                      <span className={styles.bindingCode}>{it.material_code}</span>
                      <span className={styles.bindingName}>{it.material_name}</span>
                    </div>
                    <span className={styles.bindingSku}>{it.supplier_sku ?? '—'}</span>
                    <span className={styles.bindingPrice}>
                      {fmtMoney(it.unit_price_centi, po.currency)}
                    </span>
                    <span className={styles.bindingMeta}>× {it.qty}</span>
                    <span className={styles.bindingMeta}>{fmtMoney(it.line_total_centi, po.currency)}</span>
                    <span />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {po && (
          <footer className={styles.drawerFooter}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                // Dynamic import — PDF chunk is shared with SO/DO so it's cached
                // after first use on any flow.
                import('../lib/purchase-order-pdf').then(({ generatePurchaseOrderPdf }) =>
                  generatePurchaseOrderPdf(po, items),
                ).catch((e) => alert(`PDF generation failed: ${e instanceof Error ? e.message : String(e)}`));
              }}
            >
              <Printer {...ICON} />
              <span>Print PDF</span>
            </Button>
            {/* PR-DRAFT-removal — Submit/Cancel-from-Draft removed. POs are
                SUBMITTED on create, and cancellation lives on the detail page. */}
            <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
          </footer>
        )}
      </aside>
    </>
  );
};

const SmallStat = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-14)', fontWeight: 600 }}>
      {value}
    </span>
  </div>
);
