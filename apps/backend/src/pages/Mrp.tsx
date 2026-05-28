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
import { ChevronRight, ChevronDown, RefreshCw, AlertTriangle, PackageCheck, Truck, ShoppingCart, CalendarRange } from 'lucide-react';
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
  /* Commander 2026-05-29 — turnover control: order by delivery-date window.
     Set From–To, then "Order window" creates a PO covering only that window
     (e.g. 29 May–6 Jun → one PO, 7–15 Jun → another). showUndated brings back
     SO lines with no delivery date (excluded by default — not ready to order). */
  /* Single date window with a switchable basis (like the convert page): filter
     by Delivery / Processing / SO date. Delivery basis = the turnover window. */
  const [dateBasis, setDateBasis] = useState<'delivery' | 'processing' | 'soDate'>('delivery');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showUndated, setShowUndated] = useState<boolean>(false);
  /* Commander 2026-05-29 — switch a SKU to an alternate supplier in-place
     (AutoCount Post-to-PO). { itemCode: supplierId }; wins over main binding. */
  const [supplierOverride, setSupplierOverride] = useState<Record<string, string>>({});
  const setRowSupplier = (itemCode: string, supplierId: string) =>
    setSupplierOverride((prev) => ({ ...prev, [itemCode]: supplierId }));
  /* In-app result dialog (Commander 2026-05-29: confirm INSIDE the page, not a
     browser window.confirm/alert). null = closed. */
  const [dialog, setDialog] = useState<
    | { kind: 'info'; title: string; body: string }
    | { kind: 'created'; title: string; body: string }
    | null
  >(null);

  const q = useMrp({ category, warehouseId, includeUndated: showUndated });
  const data = q.data;
  const createPos = useCreatePosFromSoItems();

  /* Delivery-date window: filter child lines + recompute the parent's Qty
     Needed / Shortage to the window. Stock/PO Outstanding stay SKU-level
     (supply isn't date-bucketed). shortageQty per line already reflects the
     date-priority allocation done server-side, so summing visible lines is
     correct. */
  const hasWindow = Boolean(dateFrom || dateTo);
  const lineDate = (l: MrpSku['lines'][number]): string | null =>
    dateBasis === 'processing' ? l.processingDate
    : dateBasis === 'soDate' ? l.soDate
    : l.deliveryDate;
  const lineInWindow = (l: MrpSku['lines'][number]): boolean => {
    const d = lineDate(l);
    if (!d) return false;
    const x = d.slice(0, 10);
    if (dateFrom && x < dateFrom) return false;
    if (dateTo && x > dateTo) return false;
    return true;
  };
  const viewSkus: MrpSku[] = (data?.skus ?? [])
    .map((s) => {
      if (!hasWindow) return s;
      const lines = s.lines.filter(lineInWindow);
      const qtyNeeded = lines.reduce((a, l) => a + l.qty, 0);
      const shortage = lines.reduce((a, l) => a + (l.source === 'shortage' ? l.shortageQty : 0), 0);
      return { ...s, lines, qtyNeeded, shortage };
    })
    .filter((s) => !hasWindow || s.lines.length > 0);

  /* One SKU can now appear as several rows (one per variant), so the row
     identity is (itemCode + variantKey), not itemCode alone. */
  const rowKey = (s: MrpSku) => `${s.itemCode}${s.variantKey}`;

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const toggleSelect = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const expandAll = () => setExpanded(new Set(viewSkus.map(rowKey)));
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
    if (picks.length === 0) {
      setDialog({ kind: 'info', title: 'Nothing to order', body: 'No uncovered (shortage) SO lines in the current selection / window.' });
      return;
    }

    // Only send overrides for the SKUs actually being ordered.
    const orderedCodes = new Set(skus.filter((s) => s.shortage > 0).map((s) => s.itemCode));
    const supplierByCode: Record<string, string> = {};
    for (const [code, sup] of Object.entries(supplierOverride)) {
      if (orderedCodes.has(code) && sup) supplierByCode[code] = sup;
    }

    createPos.mutate({ picks, mode: poMode, supplierByCode }, {
      onSuccess: (res) => {
        if (!res.total) {
          setDialog({
            kind: 'info',
            title: 'No POs created',
            body: "These SKUs aren't bound to a supplier yet. Assign each shortage SKU a main supplier (the “— none —” rows), then proceed again.",
          });
          return;
        }
        // Refresh so PO Outstanding updates immediately; keep the result in an
        // in-app dialog (not a browser alert) per commander.
        setSelected(new Set());
        void q.refetch();
        setDialog({
          kind: 'created',
          title: `Created ${res.total} PO${res.total === 1 ? '' : 's'}`,
          body: res.created.map((p) => p.poNumber).join(', '),
        });
      },
      onError: (err) => {
        const raw = err instanceof Error ? err.message : String(err);
        let codes: string[] = [];
        try {
          const m = raw.match(/\{.*\}/);
          if (m) { const j = JSON.parse(m[0]); if (j.error === 'missing_bindings' && Array.isArray(j.itemCodes)) codes = j.itemCodes; }
        } catch { /* generic */ }
        setDialog(codes.length > 0
          ? { kind: 'info', title: "SKUs not bound to a supplier", body: 'Assign these to a supplier first, then proceed:\n' + codes.map((c) => `• ${c}`).join('\n') }
          : { kind: 'info', title: 'Order failed', body: raw });
      },
    });
  };

  const shortageSkus = viewSkus.filter((s) => s.shortage > 0);
  const selectedShortageSkus = shortageSkus.filter((s) => selected.has(rowKey(s)));
  const allShortSelected = shortageSkus.length > 0 && selectedShortageSkus.length === shortageSkus.length;
  const someShortSelected = selectedShortageSkus.length > 0 && !allShortSelected;
  const toggleSelectAll = () =>
    setSelected(allShortSelected ? new Set() : new Set(shortageSkus.map(rowKey)));
  const shortageUnits = shortageSkus.reduce((a, s) => a + s.shortage, 0);
  const basisLabel = dateBasis === 'processing' ? 'Processing' : dateBasis === 'soDate' ? 'SO Date' : 'Delivery';
  const windowLabel = hasWindow
    ? `${basisLabel} ${dateFrom || '…'} → ${dateTo || '…'}`
    : '';

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
            title={
              selectedShortageSkus.length > 0 ? 'Order the selected shortage SKUs'
              : hasWindow ? `Order every shortage delivering in ${windowLabel} as one batch`
              : 'Order all shortage SKUs'
            }
          >
            <ShoppingCart {...ICON} />
            {createPos.isPending
              ? 'Processing…'
              : selectedShortageSkus.length > 0
                ? `Proceed PO (${selectedShortageSkus.length})`
                : hasWindow
                  ? `Proceed PO · window (${shortageSkus.length})`
                  : `Proceed PO (${shortageSkus.length})`}
          </button>
        </div>
      </div>

      {/* Summary badges — reflect the active delivery-date window. */}
      {data && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryChip}><PackageCheck {...ICON} /> {viewSkus.length} SKUs in demand</span>
          <span className={`${styles.summaryChip} ${shortageSkus.length > 0 ? styles.summaryChipWarn : ''}`}>
            <AlertTriangle {...ICON} /> {shortageSkus.length} SKUs short · {shortageUnits} units to order
          </span>
          {hasWindow && (
            <span className={styles.summaryChip}><CalendarRange {...ICON} /> Window {windowLabel}</span>
          )}
        </div>
      )}

      {/* Filters — Commander 2026-05-29: switchable date basis (Delivery /
          Processing / SO date) drives the window; Warehouse sits above
          Category on the right. */}
      <div className={styles.filterRow}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Date</span>
          <select className={styles.filterSelect} value={dateBasis}
            onChange={(e) => setDateBasis(e.target.value as typeof dateBasis)}
            title="Which date the From–To window filters on">
            <option value="delivery">Delivery date</option>
            <option value="processing">Processing date</option>
            <option value="soDate">SO date</option>
          </select>
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>from</span>
          <input type="date" className={styles.filterSelect} value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>to</span>
          <input type="date" className={styles.filterSelect} value={dateTo}
            onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {hasWindow && (
          <button type="button" className={styles.ghostBtn}
            onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear window</button>
        )}
        <label className={styles.filterField} title="Show SO lines that have no delivery date (not ready to order)">
          <input type="checkbox" checked={showUndated} onChange={(e) => setShowUndated(e.target.checked)} />
          <span className={styles.filterLabel}>Show no-date</span>
        </label>
        <span className={styles.filterSpacer} />
        <div className={styles.filterStack}>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Warehouse</span>
            <select className={styles.filterSelect} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="all">All warehouses</option>
              {(data?.warehouses ?? []).map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Category</span>
            <select className={styles.filterSelect} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option>
              {(data?.categories ?? ['SOFA', 'BEDFRAME', 'MATTRESS']).map((cat) => (
                <option key={cat} value={cat}>{CAT_LABELS[cat] ?? cat}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.colSelect}>
                <input
                  type="checkbox"
                  aria-label="Select all shortage rows"
                  title="Select all shortage rows"
                  disabled={shortageSkus.length === 0}
                  checked={allShortSelected}
                  ref={(el) => { if (el) el.indeterminate = someShortSelected; }}
                  onChange={toggleSelectAll}
                />
              </th>
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
            {data && viewSkus.length === 0 && (
              <tr><td colSpan={9} className={styles.stateCell}>
                {hasWindow ? 'No demand delivering in this window.' : 'No open Sales-Order demand for this filter.'}
              </td></tr>
            )}
            {viewSkus.map((sku) => {
              const k = rowKey(sku);
              return (
                <SkuRows
                  key={k}
                  sku={sku}
                  open={expanded.has(k)}
                  onToggle={() => toggle(k)}
                  selected={selected.has(k)}
                  onSelect={() => toggleSelect(k)}
                  chosenSupplierId={supplierOverride[sku.itemCode] ?? null}
                  onSupplierChange={(sid) => setRowSupplier(sku.itemCode, sid)}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* In-app result dialog — Commander 2026-05-29: confirm/result inside the
          page, not a browser alert. */}
      {dialog && (
        <div className={styles.dialogBackdrop} onClick={() => setDialog(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className={styles.dialogTitle}>{dialog.title}</h2>
            <p className={styles.dialogBody}>{dialog.body}</p>
            <div className={styles.dialogActions}>
              {dialog.kind === 'created' ? (
                <>
                  <button type="button" className={styles.ghostBtn} onClick={() => setDialog(null)}>Stay here</button>
                  <button type="button" className={styles.primaryBtn} onClick={() => { setDialog(null); navigate('/purchase-orders'); }}>
                    Open Purchase Orders
                  </button>
                </>
              ) : (
                <button type="button" className={styles.primaryBtn} onClick={() => setDialog(null)}>OK</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SkuRows = ({ sku, open, onToggle, selected, onSelect, chosenSupplierId, onSupplierChange }: {
  sku: MrpSku; open: boolean; onToggle: () => void; selected: boolean; onSelect: () => void;
  chosenSupplierId: string | null; onSupplierChange: (supplierId: string) => void;
}) => {
  const short = sku.shortage > 0;
  const defaultSupplierId = sku.suppliers.find((s) => s.isMain)?.supplierId ?? sku.suppliers[0]?.supplierId ?? '';
  const activeSupplierId = chosenSupplierId ?? defaultSupplierId;
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
        <td className={styles.descCell}>
          {sku.description ?? '—'}
          {sku.variantLabel && <span className={styles.variantTag}>{sku.variantLabel}</span>}
        </td>
        <td className={styles.num}>{sku.qtyNeeded}</td>
        <td className={styles.num}>{sku.stock}</td>
        <td className={styles.num}>{sku.poOutstanding || '—'}</td>
        <td className={`${styles.num} ${short ? styles.shortNum : ''}`}>{short ? sku.shortage : '—'}</td>
        <td className={styles.supplierCell} onClick={(e) => e.stopPropagation()}>
          {sku.suppliers.length === 0 ? (
            <span className={styles.noSupplier}>— none —</span>
          ) : sku.suppliers.length === 1 ? (
            <span><Truck {...ICON} /> {sku.suppliers[0]!.code}</span>
          ) : (
            <select
              className={styles.supplierSelect}
              value={activeSupplierId}
              onChange={(e) => onSupplierChange(e.target.value)}
              title="Switch supplier for this SKU before posting the PO"
            >
              {sku.suppliers.map((s) => (
                <option key={s.supplierId} value={s.supplierId}>
                  {s.code}{s.isMain ? ' ★' : ''}
                </option>
              ))}
            </select>
          )}
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
                  <th>Processing</th>
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
      <td>{fmtDate(ln.processingDate)}</td>
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
