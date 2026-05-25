// ----------------------------------------------------------------------------
// Inventory — AutoCount-style stock view (PR #38).
//
// 4 tabs:
//   1. Balances     — one row per SKU, Total Bal Qty + Main Supplier.
//                      Double-click row → per-warehouse breakdown drawer
//                      (Location | Qty | Unit Cost), like AutoCount's
//                      "Up To Date Cost" panel.
//   2. Movements    — append-only ledger (every GRN/DO/Consignment/PR post)
//   3. COGS (FIFO)  — FIFO consumption stream
//   4. Warehouses   — CRUD for stock locations (merged from old /warehouses page)
//
// IN  events: GRN posted, Consignment RETURN note posted
// OUT events: DO dispatched, Purchase Return posted
// COGS auto-posted via DB trigger trg_inventory_movement_fifo (migration 0053).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  Boxes, Search, ArrowUpRight, ArrowDownLeft, DollarSign, Star, X, Plus,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useWarehouses,
  useInventoryProductTotals,
  useInventoryProductBreakdown,
  useInventoryMovements,
  useInventoryLots,
  useCogsEntries,
  useCreateWarehouse,
  useUpdateWarehouse,
  type CogsEntry,
  type InventoryProductTotal,
  type Warehouse,
} from '../lib/inventory-queries';
import styles from './Inventory.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;
const ICON_MD = { size: 16, strokeWidth: 1.75 } as const;

type Tab = 'balances' | 'movements' | 'cogs' | 'warehouses';
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
          <p className={styles.subtitle}>
            Stock + FIFO COGS across {warehouses.data?.length ?? 0} warehouses · IN = GRN / Consignment-return · OUT = DO / Purchase-return
          </p>
        </div>
        <div className={styles.tabRow}>
          <button type="button" className={styles.tab} data-active={tab === 'balances'} onClick={() => setTab('balances')}>
            Balances
          </button>
          <button type="button" className={styles.tab} data-active={tab === 'movements'} onClick={() => setTab('movements')}>
            Movements
          </button>
          <button type="button" className={styles.tab} data-active={tab === 'cogs'} onClick={() => setTab('cogs')}>
            COGS (FIFO)
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

      {/* Filter row — only for Movements + COGS (Balances uses category chips above) */}
      {(tab === 'movements' || tab === 'cogs') && (
        <div className={styles.filterRow}>
          <div className={styles.warehouseChips}>
            <button type="button" className={styles.chip} data-active={warehouseId === null} onClick={() => setWarehouseId(null)}>
              All warehouses
            </button>
            {warehouses.data?.map((w) => (
              <button key={w.id} type="button" className={styles.chip}
                data-active={warehouseId === w.id} onClick={() => setWarehouseId(w.id)}>
                {w.code} · {w.name}
              </button>
            ))}
          </div>
          <div className={styles.searchBox}>
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
      {tab === 'movements' && (
        <MovementsTab warehouseId={warehouseId} search={search} warehouses={warehouses.data ?? []} />
      )}
      {tab === 'cogs' && (
        <CogsTab warehouseId={warehouseId} search={search} />
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
          <span className={styles.statCaption}>Σ across all warehouses</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Distinct SKUs</span>
          <span className={styles.statValue}>{stats.distinctSku}</span>
          <span className={styles.statCaption}>In selected category</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Inventory Value</span>
          <span className={styles.statValue}>{fmtRm(stats.totalValue)}</span>
          <span className={styles.statCaption}>FIFO cost basis</span>
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
              <th>Size</th>
              <th style={{ textAlign: 'right' }}>Total Bal Qty</th>
              <th style={{ textAlign: 'right' }}>Value</th>
              <th>Main Supplier</th>
              <th>Last Movement</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={8} className={styles.emptyRow}>
                <Boxes size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No SKUs match the filters.</div>
              </td></tr>
            )}
            {!isLoading && rows.map((r) => {
              const qtyClass = r.total_qty > 0 ? styles.numCellPos
                : r.total_qty < 0 ? styles.numCellNeg
                : styles.numCellZero;
              return (
                <tr
                  key={r.product_code}
                  onDoubleClick={() => onDrilldown(r.product_code, r.product_name)}
                  title="Double-click to see per-warehouse breakdown"
                  style={{ cursor: 'pointer' }}
                >
                  <td><span className={styles.codeChip}>{r.product_code}</span></td>
                  <td>
                    {r.product_name}
                    {r.branding && <span className={styles.numCellZero}> · {r.branding}</span>}
                  </td>
                  <td className={styles.numCellZero}>{r.category}</td>
                  <td className={styles.numCellZero}>{r.size_label ?? '—'}</td>
                  <td className={`${styles.numCell} ${qtyClass}`}>{r.total_qty.toLocaleString('en-MY')}</td>
                  <td className={`${styles.numCell} ${styles.numCellZero}`}>
                    {r.total_value_sen > 0 ? fmtRm(r.total_value_sen) : '—'}
                  </td>
                  <td>
                    {r.main_supplier_code ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Star size={11} strokeWidth={2}
                          style={{ color: 'var(--c-orange)', fill: 'var(--c-orange)' }} />
                        <span className={styles.codeChip}>{r.main_supplier_code}</span>
                      </span>
                    ) : <span className={styles.numCellZero}>—</span>}
                  </td>
                  <td className={styles.numCellZero}>{r.last_movement_at ? fmtDateTime(r.last_movement_at) : '—'}</td>
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
   Product breakdown drawer — AutoCount-style "Up To Date Cost" panel:
   per-warehouse Location | Qty | Unit Cost  +  FIFO lots underneath
   ════════════════════════════════════════════════════════════════════════ */
const ProductBreakdownDrawer = ({
  code, name, onClose,
}: { code: string; name: string; onClose: () => void }) => {
  const breakdown = useInventoryProductBreakdown(code);
  const lots = useInventoryLots(code);

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
            <span className={styles.statCaption}>Across all warehouses</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Total Value</span>
            <span className={styles.statValue}>{fmtRm(totalVal)}</span>
            <span className={styles.statCaption}>FIFO cost basis</span>
          </div>
        </div>

        {/* Per-warehouse breakdown — AutoCount's "Up To Date Cost" panel */}
        <p className={styles.eyebrow} style={{ marginTop: 'var(--space-4)' }}>
          Per-Warehouse Breakdown
        </p>
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Location</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Avg Unit Cost</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.isLoading && <tr><td colSpan={4} className={styles.emptyRow}>Loading…</td></tr>}
              {!breakdown.isLoading && balances.length === 0 && (
                <tr><td colSpan={4} className={styles.emptyRow}>No warehouse rows yet.</td></tr>
              )}
              {!breakdown.isLoading && balances.map((b) => {
                const avgCost = b.qty > 0 && b.value_sen ? b.value_sen / b.qty : 0;
                return (
                  <tr key={b.warehouse_id}>
                    <td>{b.warehouse_code} · {b.warehouse_name}</td>
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
    { value: 'CONSIGNMENT_NOTE',  label: 'Consignment' },
    { value: 'PURCHASE_RETURN',   label: 'PR (OUT)' },
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
                    {m.source_doc_no
                      ? <span className={styles.docLink}>{m.source_doc_no}</span>
                      : <span className={styles.numCellZero}>—</span>}
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
          <span className={styles.statCaption}>FIFO basis · {cogs.length} consumptions</span>
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
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};
