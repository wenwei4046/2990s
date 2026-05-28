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
import { ChevronRight, ChevronDown, RefreshCw, AlertTriangle, PackageCheck, Truck } from 'lucide-react';
import { useMrp, type MrpSku, type MrpLine } from '../lib/mrp-queries';
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
  const [category, setCategory] = useState<string>('all');
  const [warehouseId, setWarehouseId] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const q = useMrp({ category, warehouseId });
  const data = q.data;

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });

  const expandAll = () => setExpanded(new Set((data?.skus ?? []).map((s) => s.itemCode)));
  const collapseAll = () => setExpanded(new Set());

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
          <button type="button" className={styles.ghostBtn} onClick={collapseAll}>Collapse all</button>
          <button type="button" className={styles.ghostBtn} onClick={expandAll}>Expand all</button>
          <button type="button" className={styles.ghostBtn} onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw {...ICON} className={q.isFetching ? styles.spin : undefined} /> Refresh
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

      {/* Filters */}
      <div className={styles.filterRow}>
        <div className={styles.chipGroup}>
          <span className={styles.chipGroupLabel}>Category</span>
          <button type="button" className={styles.chip} data-active={category === 'all'} onClick={() => setCategory('all')}>All</button>
          {(data?.categories ?? ['SOFA', 'BEDFRAME', 'MATTRESS']).map((cat) => (
            <button key={cat} type="button" className={styles.chip} data-active={category === cat} onClick={() => setCategory(cat)}>
              {CAT_LABELS[cat] ?? cat}
            </button>
          ))}
        </div>
        <div className={styles.chipGroup}>
          <span className={styles.chipGroupLabel}>Warehouse</span>
          <button type="button" className={styles.chip} data-active={warehouseId === 'all'} onClick={() => setWarehouseId('all')}>All</button>
          {(data?.warehouses ?? []).map((w) => (
            <button key={w.id} type="button" className={styles.chip} data-active={warehouseId === w.id} onClick={() => setWarehouseId(w.id)}>
              {w.code}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
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
              <tr><td colSpan={8} className={styles.stateCell}>Loading MRP…</td></tr>
            )}
            {q.isError && (
              <tr><td colSpan={8} className={styles.stateCell}>Failed to load: {(q.error as Error)?.message}</td></tr>
            )}
            {data && data.skus.length === 0 && (
              <tr><td colSpan={8} className={styles.stateCell}>No open Sales-Order demand for this filter.</td></tr>
            )}
            {data?.skus.map((sku) => (
              <SkuRows
                key={sku.itemCode}
                sku={sku}
                open={expanded.has(sku.itemCode)}
                onToggle={() => toggle(sku.itemCode)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SkuRows = ({ sku, open, onToggle }: { sku: MrpSku; open: boolean; onToggle: () => void }) => {
  const short = sku.shortage > 0;
  return (
    <>
      <tr className={`${styles.skuRow} ${short ? styles.skuRowShort : ''}`} onClick={onToggle}>
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
