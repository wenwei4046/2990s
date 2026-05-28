// ----------------------------------------------------------------------------
// MRP · Stock Status Report (Commander 2026-05-28).
//
// Trading-company finished-goods MRP. Per SKU: how many units the open Sales
// Orders need (Qty Needed) vs what we can supply (Stock + outstanding PO),
// with the leftover = Shortage. Expand a SKU to see each SO it serves, sorted
// by delivery date, tagged with how it's covered:
//   • stock        → allocated from on-hand
//   • PO-xxxx + ETA → covered by an outstanding PO (expected arrival)
//   • SHORT (orange) → uncovered → this is what you order next
//
// Read-only, recomputed server-side on every load (no persistence — v1).
// Backed by GET /mrp (apps/api/src/routes/mrp.ts).
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, ChevronDown, RefreshCw, AlertTriangle, PackageCheck, Truck, ShoppingCart } from 'lucide-react';
import { useMrp, type MrpSku, type MrpLine, type MrpResponse } from '../lib/mrp-queries';
import { useCreatePosFromSoItems } from '../lib/suppliers-queries';
import styles from './Mrp.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

const CAT_LABELS: Record<string, string> = {
  SOFA: 'Sofa', BEDFRAME: 'Bedframe', MATTRESS: 'Mattress',
  ACCESSORY: 'Accessory', SERVICE: 'Service',
};

const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : iso;
};

export const Mrp = () => {
  const navigate = useNavigate();
  const [category, setCategory] = useState<string>('all');
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [poMode, setPoMode] = useState<'combined' | 'per-so'>('combined');

  const q = useMrp({ category, warehouseId });
  const data = q.data;
  const createPos = useCreatePosFromSoItems();

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });

  const toggleSelect = (code: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });

  const expandAll = () => setExpanded(new Set((data?.skus ?? []).map((s) => s.itemCode)));
  const collapseAll = () => setExpanded(new Set());

  /* Build {soItemId, qty} picks from the SHORT lines of the given SKUs, then
     fire the (mode-aware) convert-from-SO endpoint. Order = the shortage qty
     only (stock/PO already cover the rest). */
  const orderShortages = (skus: MrpResponse['skus']) => {
    const picks = skus
      .filter((s) => s.shortage > 0)
      .flatMap((s) => s.lines
        .filter((l) => l.source === 'shortage' && l.shortageQty > 0)
        .map((l) => ({ soItemId: l.soItemId, qty: l.shortageQty })),
      )
      .filter((p) => p.soItemId);
    if (picks.length === 0) { window.alert('Nothing to order — no uncovered SO lines in the selection.'); return; }

    createPos.mutate({ picks, mode: poMode }, {
      onSuccess: (res) => {
        if (!res.total) {
          window.alert("No POs created — these SKUs aren't bound to a supplier yet. Assign each shortage SKU a main supplier (the “— none —” rows), then order again.");
          return;
        }
        const summary = res.created.map((p) => p.poNumber).join(', ');
        if (window.confirm(`Created ${res.total} PO${res.total === 1 ? '' : 's'}: ${summary}\n\nOpen Purchase Orders now?`)) {
          navigate('/purchase-orders');
        } else {
          setSelected(new Set());
          void q.refetch();
        }
      },
      onError: (err) => {
        const raw = err instanceof Error ? err.message : String(err);
        let codes: string[] = [];
        try {
          const m = raw.match(/\{.*\}/);
          if (m) { const j = JSON.parse(m[0]); if (j.error === 'missing_bindings' && Array.isArray(j.itemCodes)) codes = j.itemCodes; }
        } catch { /* generic */ }
        if (codes.length > 0) {
          window.alert("These SKUs aren't bound to a supplier yet — assign them first:\n\n" + codes.map((c) => `• ${c}`).join('\n'));
          return;
        }
        window.alert(`Order failed: ${raw}`);
      },
    });
  };

  const shortageSkus = (data?.skus ?? []).filter((s) => s.shortage > 0);
  const selectedShortageSkus = shortageSkus.filter((s) => selected.has(s.itemCode));

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>MRP · Stock Status Report</h1>
          <p className={styles.subtitle}>
            Open Sales-Order demand vs stock + incoming POs. Orange rows still
            need ordering.
            {data && (
              <> · as of {new Date(data.asOf).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</>
            )}
          </p>
        </div>
        <div className={styles.actions}>
          {/* PO generation mode — same semantics as Create-PO-from-SO. */}
          <div className={styles.modeToggle} role="group" aria-label="PO generation mode">
            <button type="button" className={styles.modeBtn} data-active={poMode === 'combined'}
              onClick={() => setPoMode('combined')} title="One PO per supplier">Combined</button>
            <button type="button" className={styles.modeBtn} data-active={poMode === 'per-so'}
              onClick={() => setPoMode('per-so')} title="One PO per SO (sofa / bedframe)">Per SO</button>
          </div>
          <button type="button" className={styles.ghostBtn} onClick={collapseAll}>Collapse</button>
          <button type="button" className={styles.ghostBtn} onClick={expandAll}>Expand</button>
          <button type="button" className={styles.ghostBtn} onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw {...ICON} className={q.isFetching ? styles.spin : undefined} /> Refresh
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={createPos.isPending || shortageSkus.length === 0}
            onClick={() => orderShortages(selectedShortageSkus.length > 0 ? selectedShortageSkus : shortageSkus)}
            title={selectedShortageSkus.length > 0 ? 'Order the selected shortage SKUs' : 'Order all shortage SKUs'}
          >
            <ShoppingCart {...ICON} />
            {createPos.isPending
              ? 'Ordering…'
              : selectedShortageSkus.length > 0
                ? `Order ${selectedShortageSkus.length} selected`
                : `Order all shortages (${shortageSkus.length})`}
          </button>
        </div>
      </div>

      {/* Summary badges */}
      {data && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryChip}><PackageCheck {...ICON} /> {data.totals.skuCount} SKUs in demand</span>
          <span className={`${styles.summaryChip} ${data.totals.shortageSkuCount > 0 ? styles.summaryChipWarn : ''}`}>
            <AlertTriangle {...ICON} /> {data.totals.shortageSkuCount} SKUs short · {data.totals.shortageUnits} units to order
          </span>
        </div>
      )}

      {/* Filters — Commander 2026-05-29: warehouses got too many to chip; use
          compact dropdowns aligned right instead. */}
      <div className={styles.filterRow}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Category</span>
          <select className={styles.filterSelect} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            {(data?.categories ?? ['SOFA', 'BEDFRAME', 'MATTRESS']).map((cat) => (
              <option key={cat} value={cat}>{CAT_LABELS[cat] ?? cat}</option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Warehouse</span>
          <select className={styles.filterSelect} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="all">All warehouses</option>
            {(data?.warehouses ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colSelect} />
              <th className={styles.colCaret} />
              <th>Item Code</th>
              <th>Description</th>
              <th className={styles.num}>Qty Needed</th>
              <th className={styles.num}>Stock</th>
              <th className={styles.num}>PO Outstanding</th>
              <th className={styles.num}>Shortage</th>
              <th>Main Supplier</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={9} className={styles.stateCell}>Loading MRP…</td></tr>
            )}
            {q.isError && (
              <tr><td colSpan={9} className={styles.stateCell}>Failed to load: {(q.error as Error)?.message}</td></tr>
            )}
            {data && data.skus.length === 0 && (
              <tr><td colSpan={9} className={styles.stateCell}>No open Sales-Order demand for this filter.</td></tr>
            )}
            {data?.skus.map((sku) => (
              <SkuRows
                key={sku.itemCode}
                sku={sku}
                open={expanded.has(sku.itemCode)}
                onToggle={() => toggle(sku.itemCode)}
                selected={selected.has(sku.itemCode)}
                onSelect={() => toggleSelect(sku.itemCode)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SkuRows = ({ sku, open, onToggle, selected, onSelect }: {
  sku: MrpSku; open: boolean; onToggle: () => void; selected: boolean; onSelect: () => void;
}) => {
  const short = sku.shortage > 0;
  return (
    <>
      <tr className={`${styles.skuRow} ${short ? styles.skuRowShort : ''}`} onClick={onToggle}>
        <td className={styles.colSelect} onClick={(e) => e.stopPropagation()}>
          {short && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              aria-label={`Select ${sku.itemCode} to order`}
            />
          )}
        </td>
        <td className={styles.colCaret}>
          {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
        </td>
        <td className={styles.codeCell}>{sku.itemCode}</td>
        <td className={styles.descCell}>{sku.description ?? '—'}</td>
        <td className={styles.num}>{sku.qtyNeeded}</td>
        <td className={styles.num}>{sku.stock}</td>
        <td className={styles.num}>{sku.poOutstanding || '—'}</td>
        <td className={`${styles.num} ${short ? styles.shortNum : ''}`}>{short ? sku.shortage : '—'}</td>
        <td className={styles.supplierCell}>
          {sku.mainSupplierCode
            ? <span><Truck {...ICON} /> {sku.mainSupplierCode}</span>
            : <span className={styles.noSupplier}>— none —</span>}
        </td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td />
          <td />
          <td colSpan={7}>
            <table className={styles.childTable}>
              <thead>
                <tr>
                  <th>SO No</th>
                  <th>Customer</th>
                  <th>Delivery Date</th>
                  <th className={styles.num}>Qty</th>
                  <th>Coverage</th>
                </tr>
              </thead>
              <tbody>
                {sku.lines.map((ln, i) => <ChildLine key={`${ln.soDocNo}-${i}`} ln={ln} />)}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
};

const ChildLine = ({ ln }: { ln: MrpLine }) => {
  const short = ln.source === 'shortage';
  return (
    <tr className={short ? styles.childShort : undefined}>
      <td className={styles.codeCell}>{ln.soDocNo}</td>
      <td>{ln.debtorName ?? '—'}</td>
      <td>{fmtDate(ln.deliveryDate)}</td>
      <td className={styles.num}>{ln.qty}</td>
      <td>
        {ln.source === 'stock' && <span className={`${styles.tag} ${styles.tagStock}`}>stock</span>}
        {ln.source === 'po' && (
          <span className={`${styles.tag} ${styles.tagPo}`}>
            {ln.poNumber}{ln.poEta ? ` · ETA ${fmtDate(ln.poEta)}` : ''}
          </span>
        )}
        {short && (
          <span className={`${styles.tag} ${styles.tagShort}`}>
            SHORT{ln.shortageQty > 1 ? ` ×${ln.shortageQty}` : ''}
          </span>
        )}
      </td>
    </tr>
  );
};
