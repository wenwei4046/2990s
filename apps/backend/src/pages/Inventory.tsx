// ----------------------------------------------------------------------------
// Inventory — AutoCount-style stock view (PR #38).
//
// 4 tabs:
//   1. Balances     — one row per SKU, Total Bal Qty + Main Supplier.
//                      Double-click row → per-warehouse breakdown drawer
//                      (Location | Qty | Unit Cost), like AutoCount's
//                      "Up To Date Cost" panel.
//   2. Movements    — append-only ledger (every GRN/DO/PR post)
//   3. COGS (FIFO)  — FIFO consumption stream
//   4. Warehouses   — CRUD for stock locations (merged from old /warehouses page)
//
// IN  events: GRN posted
// OUT events: DO dispatched, Purchase Return posted
// COGS auto-posted via DB trigger trg_inventory_movement_fifo (migration 0053).
// ----------------------------------------------------------------------------

import { useMemo, useState, Fragment } from 'react';
import { Link } from 'react-router';
import {
  Boxes, Search, ArrowUpRight, ArrowDownLeft, DollarSign, Star, X, Plus,
  Warehouse as WarehouseIcon, ChevronRight, ChevronDown, Layers,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { formatVariantKey } from '@2990s/shared';
import {
  useWarehouses,
  useInventoryProductTotals,
  useInventoryProductBreakdown,
  useInventoryMovements,
  useInventoryLots,
  useInventoryBatches,
  useCogsEntries,
  useCreateWarehouse,
  useUpdateWarehouse,
  type CogsEntry,
  type InventoryBatch,
  type InventoryMovement,
  type InventoryProductTotal,
  type Warehouse,
} from '../lib/inventory-queries';

/** Best-effort route for a movement's source doc. Mirrors StockCard's
 *  docHrefFor so every IN/OUT/ADJUSTMENT row on the Movements ledger can be
 *  clicked through to the document that drove it. ADJUSTMENT has no per-doc
 *  detail page — link to the list. */
const docHrefFor = (m: InventoryMovement): string | null => {
  switch (m.source_doc_type) {
    case 'GRN':              return m.source_doc_id ? `/grns/${m.source_doc_id}` : null;
    case 'DO':               return m.source_doc_id ? `/mfg-delivery-orders/${m.source_doc_id}` : null;
    case 'DR':               return m.source_doc_id ? `/delivery-returns/${m.source_doc_id}` : null;
    case 'PURCHASE_RETURN':  return m.source_doc_id ? `/purchase-returns/${m.source_doc_id}` : null;
    case 'STOCK_TRANSFER':   return m.source_doc_id ? `/inventory/transfers/${m.source_doc_id}` : null;
    case 'STOCK_TAKE':       return m.source_doc_id ? `/inventory/stock-takes/${m.source_doc_id}` : null;
    case 'ADJUSTMENT':       return '/inventory/adjustments';
    default:                 return null;
  }
};
import styles from './Inventory.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;
const ICON_MD = { size: 16, strokeWidth: 1.75 } as const;

type Tab = 'balances' | 'batches' | 'warehouses';
type Category = 'all' | 'ACCESSORY' | 'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'SERVICE';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'BEDFRAME',  label: 'Bedframe' },
  { value: 'SOFA',      label: 'Sofa' },
  { value: 'MATTRESS',  label: 'Mattress' },
  { value: 'SERVICE',   label: 'Service' },
];

const fmtRm = (sen: number | null | undefined): string => {
  if (sen == null) return '—';
  return `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* Age of the stock — days since the oldest open FIFO lot was received
   (Commander 2026-05-29: "寿命" replaces Last Movement). */
const fmtAgeDays = (iso: string | null): string => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const d = Math.floor(ms / 86_400_000);
  return d === 0 ? 'today' : `${d}d`;
};

export const Inventory = () => {
  const [tab, setTab] = useState<Tab>('balances');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');

  const warehouses = useWarehouses();
  const [breakdownFor, setBreakdownFor] = useState<{ code: string; name: string } | null>(null);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Inventory</h1>
        </div>
        <div className={styles.tabRow}>
          <button type="button" className={styles.tab} data-active={tab === 'balances'} onClick={() => setTab('balances')}>
            Balances
          </button>
          <button type="button" className={styles.tab} data-active={tab === 'batches'} onClick={() => setTab('batches')}>
            Batches
          </button>
          <button type="button" className={styles.tab} data-active={tab === 'warehouses'} onClick={() => setTab('warehouses')}>
            Warehouses
          </button>
        </div>
      </div>

      {/* Category chips — only for Balances tab */}
      {tab === 'balances' && (
        <div className={styles.warehouseChips}>
          {CATEGORIES.map((cat) => (
            <button key={cat.value} type="button" className={styles.chip}
              data-active={category === cat.value} onClick={() => setCategory(cat.value)}>
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'balances' && (
        <>
          <div className={styles.filterRow}>
            <div className={styles.searchBox} style={{ width: '100%' }}>
              <Search {...ICON} className={styles.searchIcon} />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Search code / description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <BalancesTab category={category} search={search}
            onDrilldown={(code, name) => setBreakdownFor({ code, name })} />
        </>
      )}
      {tab === 'batches' && (
        <BatchesTab
          warehouseId={warehouseId}
          setWarehouseId={setWarehouseId}
          warehouses={warehouses.data ?? []}
          search={search}
          setSearch={setSearch}
        />
      )}
      {tab === 'warehouses' && (
        <WarehousesTab />
      )}

      {breakdownFor && (
        <ProductBreakdownDrawer
          code={breakdownFor.code}
          name={breakdownFor.name}
          onClose={() => setBreakdownFor(null)}
        />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Balances tab — AutoCount-style: one row per SKU + Total Qty + Main Supplier
   Double-click row → per-warehouse breakdown drawer
   ════════════════════════════════════════════════════════════════════════ */
const BalancesTab = ({
  category, search, onDrilldown,
}: {
  category: Category;
  search: string;
  onDrilldown: (code: string, name: string) => void;
}) => {
  const { data, isLoading, error } = useInventoryProductTotals({
    search: search.trim() || undefined,
    category: category === 'all' ? undefined : category,
  });
  const rows: InventoryProductTotal[] = data ?? [];

  /* Commander 2026-05-29 — bedframe/sofa must show their variant breakdown in
     the list itself ("点进去这个 variant 有哪几个种类"), not only in the drawer.
     Click the caret to expand a SKU into its attribute-composition rows. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });

  const stats = useMemo(() => ({
    totalQty: rows.reduce((s, r) => s + (r.total_qty ?? 0), 0),
    distinctSku: rows.length,
    totalValue: rows.reduce((s, r) => s + (r.total_value_sen ?? 0), 0),
  }), [rows]);

  return (
    <>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Qty</span>
          <span className={styles.statValue}>{stats.totalQty.toLocaleString('en-MY')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Distinct SKUs</span>
          <span className={styles.statValue}>{stats.distinctSku}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Inventory Value</span>
          <span className={styles.statValue}>{fmtRm(stats.totalValue)}</span>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading…' : `${rows.length} SKU rows · double-click a row to see per-warehouse breakdown`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product Code</th>
              <th>Description</th>
              <th>Category</th>
              <th style={{ textAlign: 'right' }}>Stock</th>
              <th style={{ textAlign: 'right' }}>Incoming</th>
              <th style={{ textAlign: 'right' }}>Reserve 7d</th>
              <th style={{ textAlign: 'right' }}>Reserve 14d</th>
              <th style={{ textAlign: 'right' }}>Available</th>
              <th style={{ textAlign: 'right' }}>Value</th>
              <th style={{ textAlign: 'right' }}>Unit Cost</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={11} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={11} className={styles.emptyRow}>
                <Boxes size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No SKUs match the filters.</div>
              </td></tr>
            )}
            {!isLoading && rows.map((r) => {
              const qtyClass = r.total_qty > 0 ? styles.numCellPos
                : r.total_qty < 0 ? styles.numCellNeg
                : styles.numCellZero;
              /* Bedframe + sofa carry physical variants worth breaking out. */
              const expandable = r.category === 'BEDFRAME' || r.category === 'SOFA';
              const open = expanded.has(r.product_code);
              return (
                <Fragment key={r.product_code}>
                  <tr
                    onDoubleClick={() => onDrilldown(r.product_code, r.product_name)}
                    title="Double-click to see per-warehouse breakdown"
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {expandable ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleExpand(r.product_code); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            title={open ? 'Hide variants' : 'Show variants'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', color: 'var(--fg-muted)' }}
                            aria-label={open ? 'Hide variants' : 'Show variants'}
                          >
                            {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
                          </button>
                        ) : <span style={{ width: 14, display: 'inline-block' }} />}
                        <Link
                          to={`/inventory/stock-card/${encodeURIComponent(r.product_code)}`}
                          className={styles.codeChip}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          title="Open Stock Card"
                          style={{ textDecoration: 'none' }}
                        >
                          {r.product_code}
                        </Link>
                      </span>
                    </td>
                    <td>
                      {r.product_name}
                      {r.branding && <span className={styles.numCellZero}> · {r.branding}</span>}
                    </td>
                    <td className={styles.numCellZero}>{r.category}</td>
                    <td className={`${styles.numCell} ${qtyClass}`}>{r.total_qty.toLocaleString('en-MY')}</td>
                    <td className={`${styles.numCell} ${r.incoming_qty > 0 ? styles.numCellPos : styles.numCellZero}`}>
                      {r.incoming_qty > 0 ? `+${r.incoming_qty.toLocaleString('en-MY')}` : '—'}
                    </td>
                    <td className={`${styles.numCell} ${r.reserve_7d > 0 ? '' : styles.numCellZero}`}>
                      {r.reserve_7d > 0 ? r.reserve_7d.toLocaleString('en-MY') : '—'}
                    </td>
                    <td className={`${styles.numCell} ${r.reserve_14d > 0 ? '' : styles.numCellZero}`}>
                      {r.reserve_14d > 0 ? r.reserve_14d.toLocaleString('en-MY') : '—'}
                    </td>
                    <td className={`${styles.numCell} ${r.available_qty < 0 ? styles.numCellNeg : r.available_qty > 0 ? styles.numCellPos : styles.numCellZero}`}
                      title="Stock − reserved (open SO demand)">
                      {r.available_qty.toLocaleString('en-MY')}
                    </td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>
                      {r.total_value_sen > 0 ? fmtRm(r.total_value_sen) : '—'}
                    </td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>
                      {r.total_qty > 0 && r.total_value_sen > 0 ? fmtRm(Math.round(r.total_value_sen / r.total_qty)) : '—'}
                    </td>
                    <td className={styles.numCellZero} title={r.oldest_lot_at ?? undefined}>{fmtAgeDays(r.oldest_lot_at)}</td>
                  </tr>
                  {open && <SkuVariantRows code={r.product_code} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* Inline variant rows under an expanded bedframe/sofa SKU. Sums each attribute
   composition (variant_key) across warehouses → one row per variant type, so
   the list shows "what variants this SKU has" without opening the drawer
   (Commander 2026-05-29). Lazy: only mounts (and fetches) when expanded. */
const SkuVariantRows = ({ code }: { code: string }) => {
  const bd = useInventoryProductBreakdown(code);
  const balances = (bd.data?.balances ?? []).filter((b) => b.product_code === code);
  const variants = useMemo(() => {
    const m = new Map<string, { vk: string; qty: number; value: number }>();
    for (const b of balances) {
      const vk = b.variant_key ?? '';
      const cur = m.get(vk) ?? { vk, qty: 0, value: 0 };
      cur.qty += b.qty ?? 0;
      cur.value += b.value_sen ?? 0;
      m.set(vk, cur);
    }
    return [...m.values()].sort((a, b) =>
      (formatVariantKey(a.vk) || 'Standard').localeCompare(formatVariantKey(b.vk) || 'Standard'));
  }, [balances]);

  const rowStyle = { background: 'var(--c-cream)' } as const;
  if (bd.isLoading) {
    return <tr style={rowStyle}><td /><td colSpan={10} className={styles.numCellZero}>Loading variants…</td></tr>;
  }
  if (variants.length === 0) {
    return <tr style={rowStyle}><td /><td colSpan={10} className={styles.numCellZero}>No stock buckets yet.</td></tr>;
  }
  return (
    <>
      {variants.map((v) => {
        const qtyClass = v.qty > 0 ? styles.numCellPos : v.qty < 0 ? styles.numCellNeg : styles.numCellZero;
        return (
          <tr key={v.vk} style={rowStyle}>
            <td />
            <td style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={styles.numCellZero}>↳</span>
              <span>{formatVariantKey(v.vk) || 'Standard'}</span>
            </td>
            <td />
            <td className={`${styles.numCell} ${qtyClass}`}>{v.qty.toLocaleString('en-MY')}</td>
            <td /><td /><td /><td />
            <td className={`${styles.numCell} ${styles.numCellZero}`}>{v.value > 0 ? fmtRm(v.value) : '—'}</td>
            <td /><td />
          </tr>
        );
      })}
    </>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Batches tab (Stage 4 — Commander 2026-05-31)
   ───────────────────────────────────────────────────────────────────────
   Sofa is colour-matched, produced as a SET on ONE PO = ONE dye lot = ONE
   batch (batch_no = source PO number). To ship a set with no colour diff the
   whole set must leave from ONE batch. This view shows, per warehouse, every
   open batch and the surviving component SKUs inside it — the raw material the
   allocator binds and the DO consumes from. Only produced-to-PO stock carries a
   batch; free / un-batched GRN stock never appears here (by design).
   ════════════════════════════════════════════════════════════════════════ */
const BatchesTab = ({
  warehouseId, setWarehouseId, warehouses, search, setSearch,
}: {
  warehouseId: string | null;
  setWarehouseId: (id: string | null) => void;
  warehouses: Warehouse[];
  search: string;
  setSearch: (s: string) => void;
}) => {
  const { data, isLoading, error } = useInventoryBatches({
    warehouseId: warehouseId ?? undefined,
  });
  const allBatches: InventoryBatch[] = data ?? [];

  /* Client-side search across batch no / supplier / component code+name. */
  const q = search.trim().toLowerCase();
  const batches = useMemo(() => {
    if (!q) return allBatches;
    return allBatches.filter((b) =>
      b.batchNo.toLowerCase().includes(q) ||
      (b.supplierName ?? '').toLowerCase().includes(q) ||
      b.components.some((c) =>
        c.productCode.toLowerCase().includes(q) ||
        (c.productName ?? '').toLowerCase().includes(q)),
    );
  }, [allBatches, q]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const stats = useMemo(() => ({
    batchCount: batches.length,
    totalQty: batches.reduce((s, b) => s + b.totalRemaining, 0),
    skuCount: new Set(batches.flatMap((b) => b.components.map((c) => c.productCode))).size,
  }), [batches]);

  return (
    <>
      {/* Warehouse filter chips */}
      <div className={styles.warehouseChips}>
        <button type="button" className={styles.chip}
          data-active={warehouseId === null} onClick={() => setWarehouseId(null)}>
          All warehouses
        </button>
        {warehouses.map((w) => (
          <button key={w.id} type="button" className={styles.chip}
            data-active={warehouseId === w.id} onClick={() => setWarehouseId(w.id)}>
            {w.name}
          </button>
        ))}
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchBox} style={{ width: '100%' }}>
          <Search {...ICON} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search batch / PO / supplier / component…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Open Batches</span>
          <span className={styles.statValue}>{stats.batchCount}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Modules On Hand</span>
          <span className={styles.statValue}>{stats.totalQty.toLocaleString('en-MY')}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Distinct SKUs</span>
          <span className={styles.statValue}>{stats.skuCount}</span>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading…' : `${batches.length} open batch${batches.length === 1 ? '' : 'es'} · click a row to see component SKUs`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Batch / PO</th>
              <th>Warehouse</th>
              <th>Supplier</th>
              <th style={{ textAlign: 'right' }}>Components</th>
              <th style={{ textAlign: 'right' }}>Modules</th>
              <th>Received</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && batches.length === 0 && (
              <tr><td colSpan={6} className={styles.emptyRow}>
                <Layers size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No open batches{q ? ' match the search' : ''}.</div>
              </td></tr>
            )}
            {!isLoading && batches.map((b) => {
              const key = `${b.warehouseId}|${b.batchNo}`;
              const open = expanded.has(key);
              return (
                <Fragment key={key}>
                  <tr onClick={() => toggleExpand(key)} style={{ cursor: 'pointer' }}
                    title={open ? 'Hide components' : 'Show components'}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {open ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
                        <span className={styles.codeChip}>{b.batchNo}</span>
                      </span>
                    </td>
                    <td>{b.warehouseName ?? '—'}</td>
                    <td>{b.supplierName ?? <span className={styles.numCellZero}>—</span>}</td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>{b.components.length}</td>
                    <td className={`${styles.numCell} ${b.totalRemaining > 0 ? styles.numCellPos : styles.numCellZero}`}>
                      {b.totalRemaining.toLocaleString('en-MY')}
                    </td>
                    <td className={styles.numCellZero} title={b.receivedAt ?? undefined}>{fmtAgeDays(b.receivedAt)}</td>
                  </tr>
                  {open && b.components.map((c) => (
                    <tr key={`${key}|${c.productCode}|${c.variantKey ?? ''}`} style={{ background: 'var(--c-cream)' }}>
                      <td style={{ paddingLeft: 28 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className={styles.numCellZero}>↳</span>
                          <Link
                            to={`/inventory/stock-card/${encodeURIComponent(c.productCode)}`}
                            className={styles.codeChip}
                            onClick={(e) => e.stopPropagation()}
                            title="Open Stock Card"
                            style={{ textDecoration: 'none' }}
                          >
                            {c.productCode}
                          </Link>
                        </span>
                      </td>
                      <td colSpan={2}>
                        {c.productName ?? '—'}
                        {c.variantKey && <span className={styles.numCellZero}> · {formatVariantKey(c.variantKey) || 'Standard'}</span>}
                      </td>
                      <td className={`${styles.numCell} ${styles.numCellZero}`}>{fmtRm(c.unitCostSen)}</td>
                      <td className={`${styles.numCell} ${c.qtyRemaining > 0 ? styles.numCellPos : styles.numCellZero}`}>
                        {c.qtyRemaining.toLocaleString('en-MY')}
                      </td>
                      <td className={styles.numCellZero} title={c.receivedAt ?? undefined}>{fmtAgeDays(c.receivedAt)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Product breakdown drawer — AutoCount-style "Up To Date Cost" panel:
   per-warehouse Location | Qty | Unit Cost  +  FIFO lots underneath
   ════════════════════════════════════════════════════════════════════════ */
const ProductBreakdownDrawer = ({
  code, name, onClose,
}: { code: string; name: string; onClose: () => void }) => {
  const breakdown = useInventoryProductBreakdown(code);
  const lots = useInventoryLots(code);
  const movements = useInventoryMovements({ productCode: code });
  const cogs = useCogsEntries({ productCode: code });
  const warehouses = useWarehouses();

  /* Movements + COGS sections are collapsed by default (Commander 2026-05-30).
     Operator opens what they want to see — keeps the drawer scannable. */
  const [movementsOpen, setMovementsOpen] = useState(false);
  const [cogsOpen, setCogsOpen] = useState(false);

  /* Warehouse name lookup (UUID → code) so the Movements table can show
     "SLGR" instead of "41d544bc". */
  const whById = useMemo(
    () => new Map((warehouses.data ?? []).map((w) => [w.id, w])),
    [warehouses.data],
  );

  /* Running-balance computation for Movements (same pattern as Stock Card):
     API returns DESC, reverse to ASC, accumulate signed qty, then render DESC.
     OUT subtracts, IN/ADJUSTMENT/TRANSFER add as-is (ADJUSTMENT carries a
     signed qty per inventory_movements convention). */
  const movementsWithBalance = useMemo(() => {
    const desc = movements.data ?? [];
    const asc = [...desc].reverse();
    let running = 0;
    const out: Array<typeof desc[number] & { runningBalance: number }> = [];
    for (const m of asc) {
      running += m.movement_type === 'OUT' ? -m.qty : m.qty;
      out.push({ ...m, runningBalance: running });
    }
    return out.reverse();
  }, [movements.data]);

  const balances = (breakdown.data?.balances ?? []).filter((b) => b.product_code === code);
  const totalQty = balances.reduce((s, b) => s + (b.qty ?? 0), 0);
  const totalVal = balances.reduce((s, b) => s + (b.value_sen ?? 0), 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 50,
        display: 'flex', justifyContent: 'flex-end',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: 720, maxWidth: '95vw', background: 'var(--c-cream)',
          padding: 'var(--space-5)', overflow: 'auto',
        }}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.title} style={{ fontSize: 'var(--fs-22)' }}>Stock Breakdown</h2>
            <p className={styles.subtitle}>
              <span className={styles.codeChip}>{code}</span> {name}
            </p>
          </div>
          <button type="button" className={styles.chip} onClick={onClose}>
            <X {...ICON} />
            <span>Close</span>
          </button>
        </div>

        <div className={styles.statGrid} style={{ marginTop: 'var(--space-4)' }}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Total Qty</span>
            <span className={styles.statValue}>{totalQty.toLocaleString('en-MY')}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Total Value</span>
            <span className={styles.statValue}>{fmtRm(totalVal)}</span>
          </div>
        </div>

        {/* Per-warehouse × attribute-composition breakdown. One row per
            (warehouse, variant); identical attributes are already pooled, so
            this is the SKU split into its real stock buckets (migration 0095). */}
        <p className={styles.eyebrow} style={{ marginTop: 'var(--space-4)' }}>
          Stock by Warehouse &amp; Attributes
        </p>
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Location</th>
                <th>Attributes</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Avg Unit Cost</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.isLoading && <tr><td colSpan={5} className={styles.emptyRow}>Loading…</td></tr>}
              {!breakdown.isLoading && balances.length === 0 && (
                <tr><td colSpan={5} className={styles.emptyRow}>No stock rows yet.</td></tr>
              )}
              {!breakdown.isLoading && balances.map((b) => {
                const avgCost = b.qty > 0 && b.value_sen ? b.value_sen / b.qty : 0;
                const attrs = formatVariantKey(b.variant_key);
                return (
                  <tr key={`${b.warehouse_id}|${b.variant_key ?? ''}`}>
                    <td>{b.warehouse_code} · {b.warehouse_name}</td>
                    <td>{attrs || <span className={styles.numCellZero}>Standard</span>}</td>
                    <td className={`${styles.numCell} ${b.qty > 0 ? styles.numCellPos : styles.numCellZero}`}>
                      {b.qty.toLocaleString('en-MY')}
                    </td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>
                      {avgCost > 0 ? fmtRm(avgCost) : '—'}
                    </td>
                    <td className={styles.numCell} style={{ fontWeight: 700 }}>
                      {b.value_sen && b.value_sen > 0 ? fmtRm(b.value_sen) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* FIFO lots — oldest first */}
        <p className={styles.eyebrow} style={{ marginTop: 'var(--space-4)' }}>
          FIFO Lots (oldest first — these are consumed first on the next DO)
        </p>
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Received</th>
                <th>Warehouse</th>
                <th style={{ textAlign: 'right' }}>Qty Left</th>
                <th style={{ textAlign: 'right' }}>Unit Cost</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {lots.isLoading && <tr><td colSpan={5} className={styles.emptyRow}>Loading lots…</td></tr>}
              {!lots.isLoading && (lots.data ?? []).length === 0 && (
                <tr><td colSpan={5} className={styles.emptyRow}>No open lots.</td></tr>
              )}
              {(lots.data ?? []).map((l) => (
                <tr key={l.id}>
                  <td className={styles.numCellZero}>{fmtDateTime(l.received_at)}</td>
                  <td>{l.warehouse_code ?? '—'}</td>
                  <td className={`${styles.numCell} ${styles.numCellPos}`}>{l.qty_remaining.toLocaleString('en-MY')}</td>
                  <td className={`${styles.numCell} ${styles.numCellZero}`}>{fmtRm(l.unit_cost_sen)}</td>
                  <td className={styles.numCellZero}>{l.source_doc_no ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Movements ledger — collapsed by default. Header is a button. */}
        <button type="button"
          onClick={() => setMovementsOpen((v) => !v)}
          style={{
            marginTop: 'var(--space-4)', cursor: 'pointer', background: 'transparent',
            border: 'none', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
          <span className={styles.eyebrow} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {movementsOpen ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
            Movements ({(movements.data ?? []).length}) — every stock change for this SKU
          </span>
        </button>
        {movementsOpen && (
          <div className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Warehouse</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Running</th>
                  <th>Source Doc</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.isLoading && <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>}
                {!movements.isLoading && movementsWithBalance.length === 0 && (
                  <tr><td colSpan={7} className={styles.emptyRow}>No movements yet for this SKU.</td></tr>
                )}
                {movementsWithBalance.map((m) => {
                  const href = docHrefFor(m);
                  const qtySign = m.movement_type === 'IN' ? '+' : m.movement_type === 'OUT' ? '−' : (m.qty > 0 ? '+' : m.qty < 0 ? '−' : '');
                  const qtyClass = m.qty > 0 ? styles.numCellPos : m.qty < 0 ? styles.numCellNeg : styles.numCellZero;
                  const wh = m.warehouse_id ? whById.get(m.warehouse_id) : null;
                  return (
                    <tr key={m.id}>
                      <td className={styles.numCellZero}>{fmtDateTime(m.created_at)}</td>
                      <td>
                        <span className={`${styles.movementPill} ${
                          m.movement_type === 'IN' ? styles.movementIn
                          : m.movement_type === 'OUT' ? styles.movementOut
                          : styles.movementAdj}`}>{m.movement_type}</span>
                      </td>
                      <td>{wh ? wh.code : (m.warehouse_id ? '—' : '—')}</td>
                      <td className={`${styles.numCell} ${qtyClass}`}>{qtySign}{Math.abs(m.qty).toLocaleString('en-MY')}</td>
                      <td className={`${styles.numCell}`} style={{ fontWeight: 700 }}>
                        {m.runningBalance.toLocaleString('en-MY')}
                      </td>
                      <td>
                        {m.source_doc_no ? (
                          href
                            ? <Link to={href} className={styles.docLink}>{m.source_doc_no}</Link>
                            : <span className={styles.docLink}>{m.source_doc_no}</span>
                        ) : <span className={styles.numCellZero}>—</span>}
                      </td>
                      <td className={styles.numCellZero}>{m.notes ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* COGS — collapsed by default. */}
        <button type="button"
          onClick={() => setCogsOpen((v) => !v)}
          style={{
            marginTop: 'var(--space-4)', cursor: 'pointer', background: 'transparent',
            border: 'none', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
          <span className={styles.eyebrow} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {cogsOpen ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
            COGS ({(cogs.data ?? []).length}) — FIFO consumptions for this SKU
          </span>
        </button>
        {cogsOpen && (
          <div className={styles.tableCard}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Consumed at</th>
                  <th>Source Doc</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit Cost</th>
                  <th style={{ textAlign: 'right' }}>Total Cost</th>
                  <th>From Lot</th>
                </tr>
              </thead>
              <tbody>
                {cogs.isLoading && <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>}
                {!cogs.isLoading && (cogs.data ?? []).length === 0 && (
                  <tr><td colSpan={6} className={styles.emptyRow}>No COGS entries yet for this SKU.</td></tr>
                )}
                {(cogs.data ?? []).map((c) => (
                  <tr key={c.id}>
                    <td className={styles.numCellZero}>{fmtDateTime(c.consumed_at)}</td>
                    <td><span className={styles.docLink}>{c.source_doc_no ?? '—'}</span></td>
                    <td className={`${styles.numCell} ${styles.numCellNeg}`}>−{c.qty_consumed.toLocaleString('en-MY')}</td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>{fmtRm(c.unit_cost_sen)}</td>
                    <td className={styles.numCell} style={{ fontWeight: 700 }}>{fmtRm(c.total_cost_sen)}</td>
                    <td className={styles.numCellZero}>{c.lot_source_doc_no ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Movements tab
   ════════════════════════════════════════════════════════════════════════ */
const MovementsTab = ({
  warehouseId, search, warehouses,
}: {
  warehouseId: string | null;
  search: string;
  warehouses: Array<{ id: string; code: string; name: string }>;
}) => {
  const [docType, setDocType] = useState<string | null>(null);
  const { data, isLoading, error } = useInventoryMovements({
    warehouseId: warehouseId ?? undefined,
    productCode: search.trim() || undefined,
    docType: docType ?? undefined,
  });
  const movements = data ?? [];
  const wmap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const DOC_TYPES = [
    { value: null,                label: 'All' },
    { value: 'GRN',               label: 'GRN (IN)' },
    { value: 'DO',                label: 'DO (OUT)' },
    { value: 'DR',                label: 'DR (IN)' },
    { value: 'PURCHASE_RETURN',   label: 'PR (OUT)' },
    { value: 'STOCK_TRANSFER',    label: 'Transfer' },
    { value: 'STOCK_TAKE',        label: 'Stock Take' },
    { value: 'ADJUSTMENT',        label: 'Adjustment' },
  ];

  return (
    <>
      <div className={styles.warehouseChips}>
        {DOC_TYPES.map((t) => (
          <button key={t.value ?? 'all'} type="button" className={styles.chip}
            data-active={docType === t.value}
            onClick={() => setDocType(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading…' : `${movements.length} movements (latest first)`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Warehouse</th>
              <th>Product</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit Cost</th>
              <th style={{ textAlign: 'right' }}>Line Cost</th>
              <th>Source Doc</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!isLoading && movements.length === 0 && (
              <tr><td colSpan={9} className={styles.emptyRow}>No movements match the filters.</td></tr>
            )}
            {!isLoading && movements.map((m) => {
              const w = wmap.get(m.warehouse_id);
              return (
                <tr key={m.id}>
                  <td className={styles.numCellZero}>{fmtDateTime(m.created_at)}</td>
                  <td>
                    <span className={`${styles.movementPill} ${
                      m.movement_type === 'IN' ? styles.movementIn
                      : m.movement_type === 'OUT' ? styles.movementOut
                      : styles.movementAdj}`}>
                      {m.movement_type === 'IN' && <ArrowDownLeft size={11} strokeWidth={2} style={{ marginRight: 4 }} />}
                      {m.movement_type === 'OUT' && <ArrowUpRight size={11} strokeWidth={2} style={{ marginRight: 4 }} />}
                      {m.movement_type}
                    </span>
                  </td>
                  <td>{w ? w.code : '—'}</td>
                  <td>
                    <div><span className={styles.codeChip}>{m.product_code}</span></div>
                    <div className={styles.numCellZero} style={{ fontSize: 'var(--fs-11)' }}>{m.product_name ?? '—'}</div>
                  </td>
                  <td className={`${styles.numCell} ${m.movement_type === 'IN' ? styles.numCellPos : styles.numCellNeg}`}>
                    {m.movement_type === 'IN' ? '+' : m.movement_type === 'OUT' ? '−' : ''}
                    {Math.abs(m.qty).toLocaleString('en-MY')}
                  </td>
                  <td className={`${styles.numCell} ${styles.numCellZero}`}>
                    {m.unit_cost_sen && m.unit_cost_sen > 0 ? fmtRm(m.unit_cost_sen) : '—'}
                  </td>
                  <td className={`${styles.numCell} ${styles.numCellZero}`}>
                    {m.total_cost_sen && m.total_cost_sen > 0 ? fmtRm(m.total_cost_sen) : '—'}
                  </td>
                  <td>
                    {m.source_doc_no ? (() => {
                      const href = docHrefFor(m);
                      return href
                        ? <Link to={href} className={styles.docLink}>{m.source_doc_no}</Link>
                        : <span className={styles.docLink}>{m.source_doc_no}</span>;
                    })() : <span className={styles.numCellZero}>—</span>}
                  </td>
                  <td className={styles.numCellZero}>{m.notes ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   COGS tab — FIFO consumption stream
   ════════════════════════════════════════════════════════════════════════ */
const CogsTab = ({
  warehouseId, search,
}: {
  warehouseId: string | null;
  search: string;
}) => {
  const { data, isLoading } = useCogsEntries({
    warehouseId: warehouseId ?? undefined,
    productCode: search.trim() || undefined,
  });
  const cogs: CogsEntry[] = data ?? [];
  const totalCogs = useMemo(() => cogs.reduce((s, r) => s + r.total_cost_sen, 0), [cogs]);

  return (
    <>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total COGS</span>
          <span className={styles.statValue}>{fmtRm(totalCogs)}</span>
          <span className={styles.statCaption}>{cogs.length} consumptions</span>
        </div>
      </div>

      <p className={styles.eyebrow}>{isLoading ? 'Loading…' : `${cogs.length} consumption entries`}</p>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Warehouse</th>
              <th>Product</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit Cost</th>
              <th style={{ textAlign: 'right' }}>COGS</th>
              <th>Doc</th>
              <th>Lot Received</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && cogs.length === 0 && (
              <tr><td colSpan={8} className={styles.emptyRow}>
                <DollarSign size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No COGS entries yet.</div>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                  COGS is auto-posted when a DO or Purchase Return consumes a lot.
                </div>
              </td></tr>
            )}
            {!isLoading && cogs.map((c) => (
              <tr key={c.id}>
                <td className={styles.numCellZero}>{fmtDateTime(c.consumed_at)}</td>
                <td>{c.warehouse_code}</td>
                <td><span className={styles.codeChip}>{c.product_code}</span></td>
                <td className={`${styles.numCell} ${styles.numCellNeg}`}>−{c.qty_consumed.toLocaleString('en-MY')}</td>
                <td className={`${styles.numCell} ${styles.numCellZero}`}>{fmtRm(c.unit_cost_sen)}</td>
                <td className={`${styles.numCell}`} style={{ fontWeight: 700 }}>{fmtRm(c.total_cost_sen)}</td>
                <td>{c.source_doc_no ? <span className={styles.docLink}>{c.source_doc_no}</span> : '—'}</td>
                <td className={styles.numCellZero}>
                  {fmtDateTime(c.lot_received_at)}{c.lot_source_doc_no ? ` · ${c.lot_source_doc_no}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Warehouses tab — moved from standalone /warehouses page (PR #38)
   ════════════════════════════════════════════════════════════════════════ */
const WarehousesTab = () => {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const warehouses = useWarehouses({ includeInactive });

  return (
    <>
      <div className={styles.filterRow} style={{ justifyContent: 'space-between' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-13)' }}>
          <input type="checkbox" checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)} />
          Show inactive
        </label>
        <Button variant="primary" size="md" onClick={() => setCreating(true)}>
          <Plus {...ICON_MD} />
          <span>New Warehouse</span>
        </Button>
      </div>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Location</th>
              <th>Default</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {warehouses.isLoading && (
              <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!warehouses.isLoading && (warehouses.data?.length ?? 0) === 0 && (
              <tr><td colSpan={6} className={styles.emptyRow}>
                <WarehouseIcon size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No warehouses yet.</div>
              </td></tr>
            )}
            {warehouses.data?.map((w) => (
              <tr key={w.id}>
                <td><span className={styles.codeChip}>{w.code}</span></td>
                <td>{w.name}</td>
                <td className={styles.numCellZero}>{w.location ?? '—'}</td>
                <td>{w.is_default ? <Star size={12} strokeWidth={2}
                  style={{ color: 'var(--c-orange)', fill: 'var(--c-orange)' }} /> : '—'}</td>
                <td>
                  <span className={`${styles.movementPill} ${w.is_active ? styles.movementIn : styles.movementAdj}`}>
                    {w.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(w)}>Edit</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <WarehouseDrawer
          editing={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
};

const WarehouseDrawer = ({
  editing, onClose,
}: {
  editing: Warehouse | null;
  onClose: () => void;
}) => {
  const create = useCreateWarehouse();
  const update = useUpdateWarehouse();
  const [form, setForm] = useState({
    code: editing?.code ?? '',
    name: editing?.name ?? '',
    location: editing?.location ?? '',
    isActive: editing?.is_active ?? true,
    isDefault: editing?.is_default ?? false,
  });

  const submit = () => {
    if (!form.code.trim() || !form.name.trim()) {
      alert('Code and Name are required.');
      return;
    }
    if (editing) {
      update.mutate({
        id: editing.id,
        code: form.code, name: form.name, location: form.location,
        isActive: form.isActive, isDefault: form.isDefault,
      }, { onSuccess: onClose });
    } else {
      create.mutate({
        code: form.code, name: form.name,
        location: form.location || undefined,
        isDefault: form.isDefault,
      }, { onSuccess: onClose });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 50,
        display: 'flex', justifyContent: 'flex-end',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, maxWidth: '95vw', background: 'var(--c-cream)',
          padding: 'var(--space-5)', overflow: 'auto',
        }}>
        <div className={styles.headerRow}>
          <h2 className={styles.title} style={{ fontSize: 'var(--fs-22)' }}>
            {editing ? 'Edit Warehouse' : 'New Warehouse'}
          </h2>
          <button type="button" className={styles.chip} onClick={onClose}>
            <X {...ICON} />
          </button>
        </div>

        <label style={{ display: 'block', marginTop: 'var(--space-4)' }}>
          <div className={styles.eyebrow}>Code *</div>
          <input className={styles.searchInput} style={{ width: '100%' }}
            value={form.code} placeholder="KL / PJ / JB"
            onChange={(e) => setForm((s) => ({ ...s, code: e.target.value.toUpperCase() }))} />
        </label>
        <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
          <div className={styles.eyebrow}>Name *</div>
          <input className={styles.searchInput} style={{ width: '100%' }}
            value={form.name} placeholder="KL Warehouse / 2990 PJ"
            onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        </label>
        <label style={{ display: 'block', marginTop: 'var(--space-3)' }}>
          <div className={styles.eyebrow}>Location</div>
          <input className={styles.searchInput} style={{ width: '100%' }}
            value={form.location ?? ''} placeholder="Address / area"
            onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))} />
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={form.isDefault}
              onChange={(e) => setForm((s) => ({ ...s, isDefault: e.target.checked }))} />
            Default warehouse
          </label>
          {editing && (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.isActive}
                onChange={(e) => setForm((s) => ({ ...s, isActive: e.target.checked }))} />
              Active
            </label>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={create.isPending || update.isPending}>
            {(create.isPending || update.isPending) ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
};

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '/');
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};
