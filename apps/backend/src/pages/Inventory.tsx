// ----------------------------------------------------------------------------
// Inventory — trading-company stock view (PR #37).
//
// Three tabs:
//   1. Balances  — current qty per (warehouse, product) w/ Category chips +
//                  "Show all SKUs" toggle. When toggled on, every product in
//                  the selected category appears with its balance (0 if no
//                  movement yet). Matches the Products page pattern.
//   2. Movements — append-only ledger (every GRN/DO/Consignment/PR post)
//   3. COGS      — FIFO consumption stream (which lot a DO drew from + cost)
//
// IN  events: GRN posted, Consignment RETURN note posted
// OUT events: DO dispatched, Purchase Return posted
// COGS posted via DB trigger trg_inventory_movement_fifo (migration 0053).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  Boxes, Search, ArrowUpRight, ArrowDownLeft, Layers, DollarSign, ChevronRight,
} from 'lucide-react';
import { Link } from 'react-router';
import {
  useWarehouses,
  useInventoryBalances,
  useInventoryMovements,
  useInventoryLots,
  useCogsEntries,
  useInventoryValue,
  type InventoryBalance,
  type CogsEntry,
} from '../lib/inventory-queries';
import styles from './Inventory.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

type Tab = 'balances' | 'movements' | 'cogs';
type Category = 'all' | 'ACCESSORY' | 'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'SERVICE';

const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all',       label: 'All' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'BEDFRAME',  label: 'Bedframe' },
  { value: 'SOFA',      label: 'Sofa' },
  { value: 'MATTRESS',  label: 'Mattress' },
  { value: 'SERVICE',   label: 'Service' },
];

const fmtRm = (sen: number): string =>
  `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const Inventory = () => {
  const [tab, setTab] = useState<Tab>('balances');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('all');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(true);             // default ON — show every SKU

  const warehouses = useWarehouses();
  const [lotsFor, setLotsFor] = useState<{ code: string; name: string | null } | null>(null);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Inventory</h1>
          <p className={styles.subtitle}>
            Stock + FIFO COGS across {warehouses.data?.length ?? 0} warehouses · IN = GRN / Consignment-return · OUT = DO / Purchase-return
            {' · '}<Link to="/warehouses" style={{ color: 'var(--c-burnt)' }}>Manage warehouses →</Link>
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
        </div>
      </div>

      {/* Category chips — matches Products page */}
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
        {tab === 'balances' && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-13)' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all SKUs (incl. zero balance)
          </label>
        )}
      </div>

      {tab === 'balances' && (
        <BalancesTab
          warehouseId={warehouseId}
          category={category}
          search={search}
          showAll={showAll}
          warehouses={warehouses.data ?? []}
          onDrilldown={(code, name) => setLotsFor({ code, name })}
        />
      )}
      {tab === 'movements' && (
        <MovementsTab warehouseId={warehouseId} search={search} warehouses={warehouses.data ?? []} />
      )}
      {tab === 'cogs' && (
        <CogsTab warehouseId={warehouseId} search={search} />
      )}

      {lotsFor && (
        <LotsDrawer code={lotsFor.code} name={lotsFor.name} onClose={() => setLotsFor(null)} />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Balances tab
   ════════════════════════════════════════════════════════════════════════ */
const BalancesTab = ({
  warehouseId, category, search, showAll, warehouses, onDrilldown,
}: {
  warehouseId: string | null;
  category: Category;
  search: string;
  showAll: boolean;
  warehouses: Array<{ id: string; code: string; name: string }>;
  onDrilldown: (code: string, name: string | null) => void;
}) => {
  const { data, isLoading, error } = useInventoryBalances({
    warehouseId: warehouseId ?? undefined,
    search: search.trim() || undefined,
    category: category === 'all' ? undefined : category,
    showAll,
  });
  const value = useInventoryValue({ warehouseId: warehouseId ?? undefined });
  const balances: InventoryBalance[] = data?.balances ?? [];

  const totalQty = useMemo(() => balances.reduce((s, r) => s + (r.qty ?? 0), 0), [balances]);
  const totalValue = useMemo(
    () => (value.data ?? []).reduce((s, r) => s + r.value_sen, 0),
    [value.data],
  );
  const distinctSku = useMemo(
    () => new Set(balances.filter((r) => r.qty !== 0 || showAll).map((r) => r.product_code)).size,
    [balances, showAll],
  );
  const wmap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  return (
    <>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Qty</span>
          <span className={styles.statValue}>{totalQty.toLocaleString('en-MY')}</span>
          <span className={styles.statCaption}>Across {warehouseId === null ? 'all' : '1'} warehouse{warehouseId === null && warehouses.length !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Distinct SKUs</span>
          <span className={styles.statValue}>{distinctSku}</span>
          <span className={styles.statCaption}>{showAll ? 'All active products' : 'With movements only'}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Inventory Value</span>
          <span className={styles.statValue}>{fmtRm(totalValue)}</span>
          <span className={styles.statCaption}>FIFO cost basis</span>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading balances…' : `${balances.length} ${showAll ? 'SKU rows' : 'balance rows'}`}
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
              {showAll && <th>Category</th>}
              <th>Warehouse</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              {showAll && <th style={{ textAlign: 'right' }}>Value</th>}
              <th>Last Movement</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={showAll ? 8 : 6} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!isLoading && balances.length === 0 && (
              <tr><td colSpan={showAll ? 8 : 6} className={styles.emptyRow}>
                <Boxes size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>
                  {showAll ? 'No SKUs match the filters.' : 'No stock movements yet.'}
                </div>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                  Post a GRN to bring stock in, dispatch a DO to take it out.
                </div>
              </td></tr>
            )}
            {!isLoading && balances.map((b) => {
              const w = wmap.get(b.warehouse_id);
              const qtyClass = b.qty > 0 ? styles.numCellPos : b.qty < 0 ? styles.numCellNeg : styles.numCellZero;
              return (
                <tr key={`${b.warehouse_id}-${b.product_code}`}>
                  <td><span className={styles.codeChip}>{b.product_code}</span></td>
                  <td>{b.product_name ?? '—'}{b.size_label ? <span className={styles.numCellZero}> · {b.size_label}</span> : null}</td>
                  {showAll && <td className={styles.numCellZero}>{b.category ?? '—'}</td>}
                  <td>{w ? `${w.code} · ${w.name}` : (b.warehouse_code ?? '—')}</td>
                  <td className={`${styles.numCell} ${qtyClass}`}>{b.qty.toLocaleString('en-MY')}</td>
                  {showAll && (
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>
                      {b.value_sen != null && b.value_sen > 0 ? fmtRm(b.value_sen) : '—'}
                    </td>
                  )}
                  <td className={styles.numCellZero}>{b.last_movement_at ? fmtDateTime(b.last_movement_at) : '—'}</td>
                  <td>
                    {b.qty !== 0 && (
                      <button type="button" className={styles.chip}
                        title="Show FIFO lots" style={{ padding: '4px 8px' }}
                        onClick={() => onDrilldown(b.product_code, b.product_name)}>
                        <Layers {...ICON} /> Lots
                      </button>
                    )}
                  </td>
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
            {isLoading && (
              <tr><td colSpan={8} className={styles.emptyRow}>Loading…</td></tr>
            )}
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
   Lots drawer — per-product FIFO breakdown
   ════════════════════════════════════════════════════════════════════════ */
const LotsDrawer = ({
  code, name, onClose,
}: {
  code: string;
  name: string | null;
  onClose: () => void;
}) => {
  const { data, isLoading } = useInventoryLots(code);
  const lots = data ?? [];
  const totalQty = lots.reduce((s, l) => s + l.qty_remaining, 0);
  const totalVal = lots.reduce((s, l) => s + (l.remaining_value_sen ?? l.qty_remaining * l.unit_cost_sen), 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.32)', zIndex: 50,
        display: 'flex', justifyContent: 'flex-end',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: 640, maxWidth: '90vw', background: 'var(--c-cream)',
          padding: 'var(--space-5)', overflow: 'auto',
        }}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.title} style={{ fontSize: 'var(--fs-22)' }}>FIFO Lots</h2>
            <p className={styles.subtitle}><span className={styles.codeChip}>{code}</span> {name ?? ''}</p>
          </div>
          <button type="button" className={styles.chip} onClick={onClose}>Close</button>
        </div>

        <div className={styles.statGrid} style={{ marginTop: 'var(--space-4)' }}>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Qty Remaining</span>
            <span className={styles.statValue}>{totalQty.toLocaleString('en-MY')}</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statLabel}>Remaining Value</span>
            <span className={styles.statValue}>{fmtRm(totalVal)}</span>
          </div>
        </div>

        <p className={styles.eyebrow} style={{ marginTop: 'var(--space-4)' }}>
          {isLoading ? 'Loading…' : `${lots.length} open lots (oldest first — these are consumed first)`}
        </p>

        <div className={styles.tableCard}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Received</th>
                <th>Warehouse</th>
                <th style={{ textAlign: 'right' }}>Qty Left</th>
                <th style={{ textAlign: 'right' }}>Unit Cost</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>}
              {!isLoading && lots.length === 0 && (
                <tr><td colSpan={6} className={styles.emptyRow}>No open lots.</td></tr>
              )}
              {!isLoading && lots.map((l, i) => (
                <tr key={l.id}>
                  <td className={styles.numCellZero}>
                    {i === 0 && <ChevronRight size={12} style={{ verticalAlign: 'middle', color: 'var(--c-orange)' }} />}
                    {fmtDateTime(l.received_at)}
                  </td>
                  <td>{l.warehouse_code ?? '—'}</td>
                  <td className={`${styles.numCell} ${styles.numCellPos}`}>{l.qty_remaining.toLocaleString('en-MY')}</td>
                  <td className={`${styles.numCell} ${styles.numCellZero}`}>{fmtRm(l.unit_cost_sen)}</td>
                  <td className={`${styles.numCell}`} style={{ fontWeight: 700 }}>
                    {fmtRm(l.remaining_value_sen ?? l.qty_remaining * l.unit_cost_sen)}
                  </td>
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

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};
